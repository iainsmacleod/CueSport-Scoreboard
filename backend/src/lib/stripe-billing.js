import Stripe from 'stripe';
import { config } from '../config.js';
import {
  getPaidSelfServeTier,
  getTiersCatalog,
  getTierDisplayName,
  normalizeTierName,
} from '../quotas.js';

let stripeClient = null;

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

export function buildPlansCatalog() {
  const catalog = getTiersCatalog();
  const selfServe = getPaidSelfServeTier().map((id) => {
    const limits = catalog[id] || {};
    return {
      id,
      displayName: getTierDisplayName(id),
      contact: false,
      checkout: isStripeConfigured() && !!tierToPriceId(id),
      trialDays: config.stripeTrialDays,
      limits: {
        maxApiKeys: limits.maxApiKeys,
        maxRooms: limits.maxRooms,
        maxControlConnectionsPerRoom: limits.maxControlConnectionsPerRoom,
      },
    };
  });

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
      limits: {
        maxApiKeys: network.maxApiKeys,
        maxRooms: network.maxRooms,
        maxControlConnectionsPerRoom: network.maxControlConnectionsPerRoom,
      },
    },
  ];
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
