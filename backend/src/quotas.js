import * as sqlite from './db/sqlite.js';

/** Built-in subscription tier caps — override via TIER_LIMITS_JSON or TIER_{TIER}_MAX_* env. */
const BUILTIN_TIERS = {
  starter: {
    maxApiKeys: 1,
    maxRooms: 2,
    maxControlConnectionsPerRoom: 5,
  },
  pro: {
    maxApiKeys: 3,
    maxRooms: 5,
    maxControlConnectionsPerRoom: 10,
  },
  enterprise: {
    maxApiKeys: 10,
    maxRooms: 20,
    maxControlConnectionsPerRoom: 20,
  },
  selfhost: {
    maxApiKeys: 10,
    maxRooms: 20,
    maxControlConnectionsPerRoom: 20,
  },
};

const ENV_FIELD_MAP = {
  MAX_API_KEYS: 'maxApiKeys',
  MAX_ROOMS: 'maxRooms',
  MAX_CONTROL_CONNECTIONS: 'maxControlConnectionsPerRoom',
};

function cloneTiers(source) {
  const out = {};
  for (const [tier, limits] of Object.entries(source)) {
    out[tier] = { ...limits };
  }
  return out;
}

function parseEnvInt(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadTierCatalog() {
  let tiers = cloneTiers(BUILTIN_TIERS);

  if (process.env.TIER_LIMITS_JSON) {
    try {
      const parsed = JSON.parse(process.env.TIER_LIMITS_JSON);
      for (const [tier, limits] of Object.entries(parsed)) {
        if (!limits || typeof limits !== 'object') continue;
        const base = tiers[tier] || BUILTIN_TIERS.starter;
        tiers[tier] = {
          maxApiKeys: parseEnvInt(limits.maxApiKeys, base.maxApiKeys),
          maxRooms: parseEnvInt(limits.maxRooms, base.maxRooms),
          maxControlConnectionsPerRoom: parseEnvInt(
            limits.maxControlConnectionsPerRoom,
            base.maxControlConnectionsPerRoom
          ),
        };
      }
    } catch {
      console.warn('Invalid TIER_LIMITS_JSON — using built-in tier defaults');
    }
  }

  for (const tier of Object.keys(tiers)) {
    const upper = tier.toUpperCase();
    for (const [envSuffix, field] of Object.entries(ENV_FIELD_MAP)) {
      const envKey = `TIER_${upper}_${envSuffix}`;
      if (process.env[envKey] != null && process.env[envKey] !== '') {
        tiers[tier][field] = parseEnvInt(process.env[envKey], tiers[tier][field]);
      }
    }
  }

  return tiers;
}

const tierCatalog = loadTierCatalog();
const fallbackTier = (() => {
  const fromEnv = (process.env.TIER_DEFAULT || '').toLowerCase();
  if (fromEnv && tierCatalog[fromEnv]) return fromEnv;
  // Self-host / dev auth defaults to generous selfhost tier; managed → starter.
  if (process.env.ALLOW_DEV_AUTH !== 'false') return 'selfhost';
  return 'starter';
})();

export function getTiersCatalog() {
  return tierCatalog;
}

export function getDefaultTierName() {
  return fallbackTier;
}

export function normalizeTierName(tier) {
  const key = String(tier || fallbackTier).toLowerCase();
  return tierCatalog[key] ? key : fallbackTier;
}

export function getTierLimits(accountOrTier) {
  const tier = typeof accountOrTier === 'string'
    ? normalizeTierName(accountOrTier)
    : normalizeTierName(accountOrTier?.subscription_tier);
  return { tier, ...tierCatalog[tier] };
}

export function getAccountUsage(accountId) {
  return {
    apiKeys: sqlite.countActiveApiKeys(accountId),
    rooms: sqlite.countRoomsForAccount(accountId),
  };
}

export function getAccountQuota(account) {
  const limits = getTierLimits(account);
  const usage = getAccountUsage(account.id);
  return {
    tier: limits.tier,
    limits: {
      maxApiKeys: limits.maxApiKeys,
      maxRooms: limits.maxRooms,
      maxControlConnectionsPerRoom: limits.maxControlConnectionsPerRoom,
    },
    usage,
  };
}

export function assertCanCreateApiKey(account) {
  const quota = getAccountQuota(account);
  if (quota.usage.apiKeys >= quota.limits.maxApiKeys) {
    return {
      ok: false,
      code: 'api_key_limit',
      message: `API key limit reached (${quota.limits.maxApiKeys} on ${quota.tier} plan). Revoke an unused key or upgrade your plan.`,
      quota,
    };
  }
  return { ok: true, quota };
}

export function assertCanCreateRoom(account) {
  const quota = getAccountQuota(account);
  if (quota.usage.rooms >= quota.limits.maxRooms) {
    return {
      ok: false,
      code: 'room_limit',
      message: `Table limit reached (${quota.limits.maxRooms} on ${quota.tier} plan). Upgrade for more tables.`,
      quota,
    };
  }
  return { ok: true, quota };
}

export function getMaxControlConnections(account) {
  return getTierLimits(account).maxControlConnectionsPerRoom;
}

export function isControlClient(client) {
  return client === 'mobile' || client === 'mobile_guest';
}
