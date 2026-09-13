import * as sqlite from './db/sqlite.js';

/** Built-in subscription tier caps — override via TIER_LIMITS_JSON or TIER_{TIER}_MAX_* env.
 *  Option A: 1 OBS Dock Key = 1 table (room) + 1 dock connection (seat).
 *  maxApiKeys = how many docks/tables you can connect (create one key per table)
 *  maxRooms = safety ceiling on room rows (should track keys); not a user-facing meter
 *  maxControlConnectionsPerRoom = mobile + guest connections per table (dock not counted)
 *
 *  Paid / managed ids: streamer, tournament_organizer, league_director, network_organization
 *  Self-host only: selfhost
 */
export const TIER_DISPLAY_NAMES = {
  streamer: 'Streamer',
  tournament_organizer: 'Tournament Organizer',
  league_director: 'League Director',
  network_organization: 'Network Organization',
  selfhost: 'Self-host',
};

const BUILTIN_TIERS = {
  streamer: {
    maxApiKeys: 2,
    maxRooms: 2,
    maxControlConnectionsPerRoom: 5,
  },
  tournament_organizer: {
    maxApiKeys: 3,
    maxRooms: 3,
    maxControlConnectionsPerRoom: 5,
  },
  league_director: {
    maxApiKeys: 10,
    maxRooms: 10,
    maxControlConnectionsPerRoom: 5,
  },
  network_organization: {
    maxApiKeys: 25,
    maxRooms: 25,
    maxControlConnectionsPerRoom: 10,
  },
  selfhost: {
    maxApiKeys: 2,
    maxRooms: 2,
    maxControlConnectionsPerRoom: 5,
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

function canonicalizeTierKey(tier) {
  return String(tier || '').toLowerCase().trim();
}

function loadTierCatalog() {
  let tiers = cloneTiers(BUILTIN_TIERS);

  if (process.env.TIER_LIMITS_JSON) {
    try {
      const parsed = JSON.parse(process.env.TIER_LIMITS_JSON);
      for (const [tier, limits] of Object.entries(parsed)) {
        if (!limits || typeof limits !== 'object') continue;
        const id = canonicalizeTierKey(tier);
        if (!id || !BUILTIN_TIERS[id]) continue;
        const base = tiers[id] || BUILTIN_TIERS.streamer;
        tiers[id] = {
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
  const fromEnv = canonicalizeTierKey(process.env.TIER_DEFAULT || '');
  if (fromEnv && tierCatalog[fromEnv]) return fromEnv;
  if (process.env.ALLOW_DEV_AUTH !== 'false') return 'selfhost';
  return 'streamer';
})();

export function getTiersCatalog() {
  return tierCatalog;
}

export function getDefaultTierName() {
  return fallbackTier;
}

export function getTierDisplayName(tier) {
  const id = normalizeTierName(tier);
  return TIER_DISPLAY_NAMES[id] || id;
}

export function normalizeTierName(tier) {
  const key = canonicalizeTierKey(tier || fallbackTier);
  return tierCatalog[key] ? key : fallbackTier;
}

export function getPaidSelfServeTier() {
  return ['streamer', 'tournament_organizer', 'league_director'];
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
    tierDisplayName: getTierDisplayName(limits.tier),
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
      message: `OBS Dock Key limit reached (${quota.limits.maxApiKeys} on ${quota.tierDisplayName} plan). Each key connects one dock — remove an unused key or upgrade your plan.`,
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
      message: `Table limit reached (${quota.limits.maxRooms} on ${quota.tierDisplayName} plan). Upgrade for more tables.`,
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
