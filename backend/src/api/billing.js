import * as sqlite from '../db/sqlite.js';
import { config } from '../config.js';
import { getAccountQuota } from '../quotas.js';
import { isAccountAdminAuth } from '../lib/dock-roles.js';
import {
  buildPlansCatalogFromStripe,
  customerHasPriorSubscription,
  getStripe,
  getSubscriptionBillingSummary,
  isStripeConfigured,
  mapStripeSubscriptionStatus,
  tierFromSubscription,
  tierToPriceId,
  trialDaysForTier,
} from '../lib/stripe-billing.js';
import {
  hasCloudSubscriptionAccess,
  isAdminSupportTrialActive,
} from '../lib/subscription-access.js';

async function resolveAccountAuth(request) {
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  if (token.startsWith('dev:')) {
    const { resolveDevAccountFromToken } = await import('../dev-auth.js');
    const account = resolveDevAccountFromToken(token);
    if (!account) return null;
    return { account, authMethod: 'dev' };
  }

  const { authenticateJoin } = await import('../ws/auth.js');
  const result = await authenticateJoin({ accessToken: token, client: 'dashboard' });
  if (result.error) return null;
  return { account: result.account, authMethod: result.authMethod || 'jwt' };
}

async function ensureStripeCustomer(account) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  if (account.stripe_customer_id) {
    return account.stripe_customer_id;
  }
  const customer = await stripe.customers.create({
    email: account.email,
    metadata: { account_id: account.id },
  });
  sqlite.setAccountStripeCustomerId(account.id, customer.id);
  return customer.id;
}

function syncAccountFromSubscription(accountId, subscription) {
  if (!accountId || !subscription) return null;
  const status = mapStripeSubscriptionStatus(subscription.status);
  const tier = tierFromSubscription(subscription);
  return sqlite.updateAccountSubscription(accountId, {
    subscriptionStatus: status,
    subscriptionTier: tier || undefined,
    stripeCustomerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id,
    stripeSubscriptionId: subscription.id,
  });
}

export async function registerBillingRoutes(app) {
  app.get('/api/billing/plans', async (request) => {
    const plans = await buildPlansCatalogFromStripe();
    const streamer = plans.find((p) => p.id === 'streamer');
    const catalogTrialDays = streamer?.trialDays ?? null;

    let trialEligible = catalogTrialDays != null;
    const auth = await resolveAccountAuth(request);
    if (auth?.account && isAccountAdminAuth(auth) && catalogTrialDays != null) {
      const customerId = auth.account.stripe_customer_id;
      if (customerId && await customerHasPriorSubscription(customerId)) {
        trialEligible = false;
      }
    }

    const plansForCaller = trialEligible
      ? plans
      : plans.map((plan) => (plan.id === 'streamer' ? { ...plan, trialDays: null } : plan));

    return {
      plans: plansForCaller,
      /** Streamer trial days offered to this caller (null if none or already used). */
      trialDays: trialEligible ? catalogTrialDays : null,
      /** False when this Stripe customer already had a subscription (one trial per email). */
      trialEligible,
      /** True when Streamer Product metadata defines a trial (regardless of caller eligibility). */
      trialConfigured: catalogTrialDays != null,
      stripeConfigured: isStripeConfigured(),
      contactUrl: config.billingContactUrl || null,
      termsUrl: `${config.publicUrl}/terms`,
      privacyUrl: `${config.publicUrl}/privacy`,
    };
  });

  app.get('/api/billing/summary', async (request, reply) => {
    const auth = await resolveAccountAuth(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    const summary = await getSubscriptionBillingSummary(auth.account);
    return {
      complimentary: isAdminSupportTrialActive(auth.account),
      trial_ends_at: auth.account.trial_ends_at || null,
      stripe: summary,
    };
  });

  app.post('/api/billing/checkout', async (request, reply) => {
    const auth = await resolveAccountAuth(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    if (config.allowDevAuth) {
      return reply.code(400).send({
        error: 'Stripe Checkout is disabled while ALLOW_DEV_AUTH=true. Set ALLOW_DEV_AUTH=false on the managed cloud server, recreate the container, and sign in with Google.',
        code: 'selfhost_no_checkout',
      });
    }
    if (!isStripeConfigured()) {
      return reply.code(503).send({
        error: 'Stripe billing is not configured on this server',
        code: 'stripe_not_configured',
      });
    }

    const acceptedTerms = !!(request.body?.acceptedTerms);
    if (!acceptedTerms) {
      return reply.code(400).send({
        error: 'You must accept the Terms of Service and Privacy Policy to continue',
        code: 'terms_required',
      });
    }

    const tier = String(request.body?.tier || '').trim();
    const priceId = tierToPriceId(tier);
    if (!priceId) {
      return reply.code(400).send({
        error: 'Choose Streamer, Tournament Organizer, or League Director',
        code: 'invalid_tier',
      });
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(auth.account);
    const successUrl = `${config.publicUrl}/dashboard?billing=success`;
    const cancelUrl = `${config.publicUrl}/dashboard?billing=cancel`;
    const catalogTrialDays = await trialDaysForTier(tier);
    const priorSub = catalogTrialDays != null
      ? await customerHasPriorSubscription(customerId)
      : false;
    const trialDays = catalogTrialDays != null && !priorSub ? catalogTrialDays : null;

    const subscriptionData = {
      metadata: {
        account_id: auth.account.id,
        tier,
      },
    };
    if (trialDays != null) {
      subscriptionData.trial_period_days = trialDays;
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: auth.account.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: subscriptionData,
        metadata: {
          account_id: auth.account.id,
          tier,
        },
        allow_promotion_codes: true,
        // Stripe Tax: address required; B2B customers can enter a tax ID at Checkout.
        billing_address_collection: 'required',
        customer_update: {
          address: 'auto',
          name: 'auto',
        },
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
      });
    } catch (err) {
      const stripeMsg = err?.raw?.message || err?.message || 'Checkout session failed';
      request.log.warn({ err, tier, priceId }, 'Stripe Checkout session create failed');
      return reply.code(400).send({
        error: stripeMsg,
        code: err?.code || 'stripe_checkout_failed',
      });
    }

    return { url: session.url, id: session.id };
  });

  app.post('/api/billing/portal', async (request, reply) => {
    const auth = await resolveAccountAuth(request);
    if (!auth?.account) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAccountAdminAuth(auth)) {
      return reply.code(403).send({ error: 'Account sign-in required' });
    }
    if (!isStripeConfigured()) {
      return reply.code(503).send({
        error: 'Stripe billing is not configured on this server',
        code: 'stripe_not_configured',
      });
    }
    if (!auth.account.stripe_customer_id) {
      return reply.code(400).send({
        error: 'No billing customer yet — choose a plan first',
        code: 'no_customer',
      });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: auth.account.stripe_customer_id,
      return_url: `${config.publicUrl}/dashboard`,
    });
    return { url: session.url };
  });

  app.post('/api/stripe/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const stripe = getStripe();
    if (!stripe || !config.stripeWebhookSecret) {
      return reply.code(503).send({ error: 'Stripe webhook not configured' });
    }

    const signature = request.headers['stripe-signature'];
    let event;
    try {
      const raw = request.rawBody;
      if (!raw) {
        return reply.code(400).send({ error: 'Missing raw body for webhook signature' });
      }
      event = stripe.webhooks.constructEvent(raw, signature, config.stripeWebhookSecret);
    } catch (err) {
      request.log.warn({ err }, 'Stripe webhook signature verification failed');
      return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
    }

    try {
      await handleStripeEvent(event, request.log);
    } catch (err) {
      request.log.error({ err, type: event.type }, 'Stripe webhook handler failed');
      return reply.code(500).send({ error: 'Webhook handler failed' });
    }

    return { received: true };
  });
}

async function handleStripeEvent(event, log) {
  const type = event.type;
  const obj = event.data?.object;

  if (type === 'checkout.session.completed') {
    const accountId = obj?.metadata?.account_id || obj?.client_reference_id;
    const customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
    const subscriptionId = typeof obj?.subscription === 'string' ? obj.subscription : obj?.subscription?.id;
    if (accountId && customerId) {
      sqlite.setAccountStripeCustomerId(accountId, customerId);
    }
    if (accountId && subscriptionId) {
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      syncAccountFromSubscription(accountId, subscription);
    }
    return;
  }

  if (
    type === 'customer.subscription.created'
    || type === 'customer.subscription.updated'
    || type === 'customer.subscription.deleted'
  ) {
    const subscription = obj;
    const accountId = subscription?.metadata?.account_id
      || sqlite.findAccountIdByStripeCustomerId(
        typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
      );
    if (!accountId) {
      log?.warn({ type, subscriptionId: subscription?.id }, 'Stripe subscription event with no account');
      return;
    }
    if (type === 'customer.subscription.deleted') {
      sqlite.updateAccountSubscription(accountId, {
        subscriptionStatus: 'inactive',
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id,
      });
      return;
    }
    syncAccountFromSubscription(accountId, subscription);
    return;
  }

  if (type === 'invoice.payment_failed' || type === 'invoice.paid') {
    const customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
    const subscriptionId = typeof obj?.subscription === 'string' ? obj.subscription : obj?.subscription?.id;
    if (!subscriptionId) return;
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const accountId = subscription.metadata?.account_id
      || sqlite.findAccountIdByStripeCustomerId(customerId);
    if (accountId) syncAccountFromSubscription(accountId, subscription);
  }
}

/** Enrich /api/me-style payloads with billing access flags. */
export function billingAccountFields(account) {
  const status = account?.subscription_status || 'inactive';
  const access = hasCloudSubscriptionAccess(account);
  const complimentary = isAdminSupportTrialActive(account);
  return {
    subscription_status: status,
    subscription_tier: account?.subscription_tier || null,
    trial_ends_at: account?.trial_ends_at || null,
    stripe_customer_id: account?.stripe_customer_id || null,
    stripe_subscription_id: account?.stripe_subscription_id || null,
    has_subscription_access: access,
    is_complimentary: complimentary,
    needs_plan: !access && !config.allowDevAuth,
    quota: account ? getAccountQuota(account) : null,
  };
}
