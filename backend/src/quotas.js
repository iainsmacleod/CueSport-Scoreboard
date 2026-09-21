import * as sqlite from './db/sqlite.js';
import { isPlatformAdmin } from './lib/platform-admin.js';
import { config } from './config.js';

/** Built-in subscription tier caps — override via TIER_LIMITS_JSON or TIER_{TIER}_MAX_* env.
 *  Option A: 1 OBS Dock Key = 1 table (room) + 1 dock connection (seat).
 *  maxApiKeys = how many docks/tables you can connect (create one key per table)
 *  maxRooms = safety ceiling on dock room rows (should track keys); not a user-facing meter
 *  maxImpromptuTables = dockless scoring tables (separate from Dock Key seats)
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
    maxImpromptuTables: 2,
    maxControlConnectionsPerRoom: 5,
  },
  tournament_organizer: {
    maxApiKeys: 5,
    maxRooms: 5,
    maxImpromptuTables: 5,
    maxControlConnectionsPerRoom: 5,
  },
  league_director: {
    maxApiKeys: 10,
    maxRooms: 10,
    maxImpromptuTables: 10,
    maxControlConnectionsPerRoom: 5,
  },
  network_organization: {
    maxApiKeys: 25,
    maxRooms: 25,
    maxImpromptuTables: 25,
    maxControlConnectionsPerRoom: 10,
  },
  selfhost: {
    maxApiKeys: 2,
    maxRooms: 2,
    maxImpromptuTables: 2,
    maxControlConnectionsPerRoom: 5,
  },
};

const ENV_FIELD_MAP = {
  MAX_API_KEYS: 'maxApiKeys',
  MAX_ROOMS: 'maxRooms',
  MAX_IMPROMPTU_TABLES: 'maxImpromptuTables',
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
          maxImpromptuTables: parseEnvInt(limits.maxImpromptuTables, base.maxImpromptuTables),
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
    rooms: sqlite.countDockRoomsForAccount(accountId),
    impromptuTables: sqlite.countImpromptuRoomsForAccount(accountId),
  };
}

/** @returns {'unrestricted'|string} */
export function resolveSimulatedPlan(account) {
  const raw = String(account?.simulated_plan || '').trim().toLowerCase();
  if (!raw || raw === 'unrestricted' || raw === 'platform_admin') return 'unrestricted';
  return normalizeTierName(raw);
}

export function getSimulatedPlanOptions() {
  return [
    { id: 'unrestricted', label: 'Unrestricted' },
    ...Object.keys(tierCatalog).map((id) => ({
      id,
      label: getTierDisplayName(id),
    })),
  ];
}

function unrestrictedLimits() {
  return {
    maxApiKeys: null,
    maxRooms: null,
    maxImpromptuTables: null,
    maxControlConnectionsPerRoom: null,
  };
}

function limitsPayload(limits) {
  return {
    maxApiKeys: limits.maxApiKeys,
    maxRooms: limits.maxRooms,
    maxImpromptuTables: limits.maxImpromptuTables,
    maxControlConnectionsPerRoom: limits.maxControlConnectionsPerRoom,
  };
}

export function getAccountQuota(account) {
  const usage = getAccountUsage(account.id);
  if (config.allowDevAuth) {
    return {
      tier: 'selfhost',
      tierDisplayName: 'Self-host (unrestricted)',
      limits: unrestrictedLimits(),
      usage,
      self_host_unrestricted: true,
    };
  }
  if (isPlatformAdmin(account)) {
    const simulated = resolveSimulatedPlan(account);
    if (simulated === 'unrestricted') {
      return {
        tier: 'platform_admin',
        tierDisplayName: 'Platform admin (unrestricted)',
        limits: unrestrictedLimits(),
        usage,
        platform_admin_unlimited: true,
        simulated_plan: 'unrestricted',
      };
    }
    const limits = getTierLimits(simulated);
    return {
      tier: limits.tier,
      tierDisplayName: `${getTierDisplayName(limits.tier)} (simulated)`,
      limits: limitsPayload(limits),
      usage,
      platform_admin_unlimited: false,
      simulated_plan: limits.tier,
    };
  }
  const limits = getTierLimits(account);
  return {
    tier: limits.tier,
    tierDisplayName: getTierDisplayName(limits.tier),
    limits: limitsPayload(limits),
    usage,
  };
}

export function assertCanCreateApiKey(account) {
  const quota = getAccountQuota(account);
  if (quota.limits.maxApiKeys == null) {
    return { ok: true, quota };
  }
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
  if (quota.limits.maxRooms == null) {
    return { ok: true, quota };
  }
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

export function assertCanCreateImpromptuTable(account) {
  const quota = getAccountQuota(account);
  if (quota.limits.maxImpromptuTables == null) {
    return { ok: true, quota };
  }
  if (quota.usage.impromptuTables >= quota.limits.maxImpromptuTables) {
    return {
      ok: false,
      code: 'impromptu_table_limit',
      message: `Impromptu table limit reached (${quota.limits.maxImpromptuTables} on ${quota.tierDisplayName} plan). End a match to free a seat, or upgrade your plan.`,
      quota,
    };
  }
  return { ok: true, quota };
}

/** Soft ceiling for mobile/guest seats per table. */
export function getMaxControlConnections(account) {
  if (config.allowDevAuth) return 100;
  if (isPlatformAdmin(account)) {
    const simulated = resolveSimulatedPlan(account);
    if (simulated === 'unrestricted') return 100;
    return getTierLimits(simulated).maxControlConnectionsPerRoom;
  }
  return getTierLimits(account).maxControlConnectionsPerRoom;
}

export function isControlClient(client) {
  return client === 'mobile' || client === 'mobile_guest';
}
