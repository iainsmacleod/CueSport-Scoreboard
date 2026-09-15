import Stripe from 'stripe';
import { config } from '../config.js';
import {
  getPaidSelfServeTier,
  getTiersCatalog,
  getTierDisplayName,
  normalizeTierName,
} from '../quotas.js';

let stripeClient = null;

const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
/** @type {Map<string, { expiresAt: number, value: object|null }>} */
const priceCache = new Map();
/** @type {{ expiresAt: number, value: object[] }|null} */
let catalogCache = null;
/** @type {Map<string, { expiresAt: number, value: object|null }>} */
const subscriptionSummaryCache = new Map();

export function isStripeConfigured() {
  return !!(config.stripeSecretKey && config.stripePriceStreamer
    && config.stripePriceTournamentOrganizer && config.stripePriceLeagueDirector);
}

export function getStripe() {
  if (!config.stripeSecretKey) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey);
  }
  return stripeClient;
}

/** Map Stripe Price ID → internal tier id */
export function priceIdToTier(priceId) {
  if (!priceId) return null;
  const map = {
    [config.stripePriceStreamer]: 'streamer',
    [config.stripePriceTournamentOrganizer]: 'tournament_organizer',
    [config.stripePriceLeagueDirector]: 'league_director',
  };
  return map[priceId] || null;
}

export function tierToPriceId(tier) {
  const id = normalizeTierName(tier);
  const map = {
    streamer: config.stripePriceStreamer,
    tournament_organizer: config.stripePriceTournamentOrganizer,
    league_director: config.stripePriceLeagueDirector,
  };
  return map[id] || null;
}

function parseTrialDaysFromMetadata(metadata) {
  const raw = metadata?.trial_period_days;
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unixToIso(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

/**
 * Retrieve a Stripe Price (expand product) with short TTL cache.
 * @returns {Promise<{
 *   priceId: string,
 *   unitAmount: number|null,
 *   currency: string|null,
 *   interval: string|null,
 *   trialDays: number|null,
 *   productName: string|null,
 * }|null>}
 */
export async function retrievePriceDetails(priceId) {
  if (!priceId) return null;
  const cached = priceCache.get(priceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const stripe = getStripe();
  if (!stripe) {
    priceCache.set(priceId, { expiresAt: Date.now() + PRICE_CACHE_TTL_MS, value: null });
    return null;
  }

  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = typeof price.product === 'object' && price.product ? price.product : null;
    const value = {
      priceId,
      unitAmount: price.unit_amount != null ? price.unit_amount : null,
      currency: price.currency || null,
      interval: price.recurring?.interval || null,
      trialDays: parseTrialDaysFromMetadata(product?.metadata),
      productName: product?.name || null,
    };
    priceCache.set(priceId, { expiresAt: Date.now() + PRICE_CACHE_TTL_MS, value });
    return value;
  } catch {
    priceCache.set(priceId, { expiresAt: Date.now() + Math.min(60_000, PRICE_CACHE_TTL_MS), value: null });
    return null;
  }
}

/** Trial days for a tier from Stripe Product metadata (null = no trial). */
export async function trialDaysForTier(tier) {
  const priceId = tierToPriceId(tier);
  if (!priceId) return null;
  const details = await retrievePriceDetails(priceId);
  return details?.trialDays ?? null;
}

/**
 * True if this Stripe customer already has any subscription (including canceled).
 * Used to allow only one free trial per email / customer.
 */
export async function customerHasPriorSubscription(customerId) {
  if (!customerId) return false;
  const stripe = getStripe();
  if (!stripe) return false;
  try {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 1,
    });
    return (list?.data?.length || 0) > 0;
  } catch {
    // Fail closed for trials: if we cannot verify history, do not grant another trial.
    return true;
  }
}

function basePlanRow(id, limits) {
  return {
    id,
    displayName: getTierDisplayName(id),
    contact: false,
    checkout: isStripeConfigured() && !!tierToPriceId(id),
    trialDays: null,
    unitAmount: null,
    currency: null,
    interval: null,
    limits: {
      maxApiKeys: limits.maxApiKeys,
      maxRooms: limits.maxRooms,
      maxControlConnectionsPerRoom: limits.maxControlConnectionsPerRoom,
    },
  };
}

/** Sync catalog without Stripe enrichment (tests / Stripe down). */
export function buildPlansCatalog() {
  const catalog = getTiersCatalog();
  const selfServe = getPaidSelfServeTier().map((id) => basePlanRow(id, catalog[id] || {}));
  if (!config.billingShowNetworkOrganization) {
    return selfServe;
  }
  const network = catalog.network_organization || {};
  return [
    ...selfServe,
    {
      id: 'network_organization',
      displayName: getTierDisplayName('network_organization'),
      contact: true,
      checkout: false,
      contactUrl: config.billingContactUrl || null,
      trialDays: null,
      unitAmount: null,
      currency: null,
      interval: null,
      limits: {
        maxApiKeys: network.maxApiKeys,
        maxRooms: network.maxRooms,
        maxControlConnectionsPerRoom: network.maxControlConnectionsPerRoom,
      },
    },
  ];
}

/** Plans catalog enriched with Stripe Price amounts + Product trial metadata. */
export async function buildPlansCatalogFromStripe() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.value;
  }

  const base = buildPlansCatalog();
  if (!isStripeConfigured()) {
    catalogCache = { expiresAt: Date.now() + PRICE_CACHE_TTL_MS, value: base };
    return base;
  }

  const enriched = await Promise.all(base.map(async (plan) => {
    if (plan.contact) return plan;
    const priceId = tierToPriceId(plan.id);
    if (!priceId) return plan;
    const details = await retrievePriceDetails(priceId);
    if (!details) return plan;
    return {
      ...plan,
      trialDays: details.trialDays,
      unitAmount: details.unitAmount,
      currency: details.currency,
      interval: details.interval,
    };
  }));

  catalogCache = { expiresAt: Date.now() + PRICE_CACHE_TTL_MS, value: enriched };
  return enriched;
}

/**
 * Live Stripe subscription summary for account menu / billing UI.
 * @returns {Promise<{
 *   planName: string|null,
 *   tier: string|null,
 *   status: string|null,
 *   unitAmount: number|null,
 *   currency: string|null,
 *   interval: string|null,
 *   currentPeriodEnd: string|null,
 *   trialEnd: string|null,
 * }|null>}
 */
export async function getSubscriptionBillingSummary(account) {
  const subscriptionId = account?.stripe_subscription_id;
  if (!subscriptionId || !isStripeConfigured()) return null;

  const cached = subscriptionSummaryCache.get(subscriptionId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const stripe = getStripe();
  if (!stripe) return null;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    });
    const item = subscription.items?.data?.[0];
    const price = item?.price;
    const priceId = price?.id || null;
    const tier = priceIdToTier(priceId) || account.subscription_tier || null;
    const value = {
      planName: tier ? getTierDisplayName(tier) : (price?.nickname || null),
      tier,
      status: mapStripeSubscriptionStatus(subscription.status),
      unitAmount: price?.unit_amount != null ? price.unit_amount : null,
      currency: price?.currency || null,
      interval: price?.recurring?.interval || null,
      currentPeriodEnd: unixToIso(subscription.current_period_end),
      trialEnd: unixToIso(subscription.trial_end),
    };
    subscriptionSummaryCache.set(subscriptionId, {
      expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
      value,
    });
    return value;
  } catch {
    subscriptionSummaryCache.set(subscriptionId, {
      expiresAt: Date.now() + Math.min(60_000, PRICE_CACHE_TTL_MS),
      value: null,
    });
    return null;
  }
}

/** @internal test helper */
export function clearStripeBillingCaches() {
  priceCache.clear();
  catalogCache = null;
  subscriptionSummaryCache.clear();
}

export function mapStripeSubscriptionStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'trialing') return 'trialing';
  if (s === 'active') return 'active';
  if (s === 'past_due') return 'past_due';
  if (s === 'canceled' || s === 'unpaid' || s === 'incomplete_expired') return 'inactive';
  if (s === 'incomplete') return 'inactive';
  return s || 'inactive';
}

export function tierFromSubscription(subscription) {
  const item = subscription?.items?.data?.[0];
  const priceId = item?.price?.id || item?.plan?.id || null;
  return priceIdToTier(priceId);
}
