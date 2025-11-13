'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'streams.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize database schema
function initDatabase() {
    // Streams table - stores current active stream states
    db.exec(`
        CREATE TABLE IF NOT EXISTS streams (
            stream_id TEXT PRIMARY KEY,
            api_key TEXT NOT NULL UNIQUE,
            player1_name TEXT DEFAULT '',
            player2_name TEXT DEFAULT '',
            player1_enabled INTEGER DEFAULT 1,
            player2_enabled INTEGER DEFAULT 1,
            score_display INTEGER DEFAULT 1,
            ball_tracker_enabled INTEGER DEFAULT 0,
            shot_clock_enabled INTEGER DEFAULT 0,
            p1_score INTEGER DEFAULT 0,
            p2_score INTEGER DEFAULT 0,
            game_type TEXT DEFAULT 'game1',
            race_info TEXT DEFAULT '',
            game_info TEXT DEFAULT '',
            stream_url TEXT DEFAULT '',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create index on api_key for faster lookups
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_api_key ON streams(api_key)
    `);

    // Create index on is_active for filtering active streams
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_is_active ON streams(is_active)
    `);

    // API keys table - stores block status and metadata
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
            api_key TEXT PRIMARY KEY,
            is_blocked INTEGER DEFAULT 0,
            blocked_reason TEXT,
            blocked_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Connections table - stores per-session metrics
    db.exec(`
        CREATE TABLE IF NOT EXISTS connections (
            connection_id TEXT PRIMARY KEY,
            api_key TEXT NOT NULL,
            connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            disconnected_at DATETIME,
            duration_seconds INTEGER DEFAULT 0,
            last_game_type TEXT DEFAULT '',
            last_stream_url TEXT DEFAULT '',
            used_score_display INTEGER DEFAULT 0,
            used_ball_tracker INTEGER DEFAULT 0,
            used_shot_clock INTEGER DEFAULT 0,
            total_updates INTEGER DEFAULT 0,
            features_json TEXT,
            last_update_at DATETIME
        )
    `);

    // Track game type usage per connection
    db.exec(`
        CREATE TABLE IF NOT EXISTS connection_game_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            game_type TEXT NOT NULL,
            change_count INTEGER DEFAULT 0
        )
    `);

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_game_types_unique
        ON connection_game_types(connection_id, game_type)
    `);

    // Migration: Add stream_url column if it doesn't exist
    try {
        const tableInfo = db.prepare("PRAGMA table_info(streams)").all();
        const hasStreamUrl = tableInfo.some(col => col.name === 'stream_url');
        const hasPlayer1Enabled = tableInfo.some(col => col.name === 'player1_enabled');
        const hasPlayer2Enabled = tableInfo.some(col => col.name === 'player2_enabled');
        const hasScoreDisplay = tableInfo.some(col => col.name === 'score_display');
        const hasBallTrackerEnabled = tableInfo.some(col => col.name === 'ball_tracker_enabled');
        const hasShotClockEnabled = tableInfo.some(col => col.name === 'shot_clock_enabled');
        
        if (!hasStreamUrl) {
            console.log('Migrating database: Adding stream_url column...');
            db.exec(`
                ALTER TABLE streams ADD COLUMN stream_url TEXT DEFAULT ''
            `);
            console.log('Migration complete: stream_url column added');
        }

        if (!hasPlayer1Enabled) {
            console.log('Migrating database: Adding player1_enabled column...');
            db.exec(`
                ALTER TABLE streams ADD COLUMN player1_enabled INTEGER DEFAULT 1
            `);
            console.log('Migration complete: player1_enabled column added');
        }

        if (!hasPlayer2Enabled) {
            console.log('Migrating database: Adding player2_enabled column...');
            db.exec(`
                ALTER TABLE streams ADD COLUMN player2_enabled INTEGER DEFAULT 1
            `);
            console.log('Migration complete: player2_enabled column added');
        }

        if (!hasScoreDisplay) {
            console.log('Migrating database: Adding score_display column...');
            db.exec(`
                ALTER TABLE streams ADD COLUMN score_display INTEGER DEFAULT 1
            `);
            console.log('Migration complete: score_display column added');
        }

        if (!hasBallTrackerEnabled) {
            console.log('Migrating database: Adding ball_tracker_enabled column...');
            db.exec(`
                ALTER TABLE streams ADD COLUMN ball_tracker_enabled INTEGER DEFAULT 0
            `);
            console.log('Migration complete: ball_tracker_enabled column added');
        }

        if (!hasShotClockEnabled) {
            console.log('Migrating database: Adding shot_clock_enabled column...');
            db.exec(`
                ALTER TABLE streams ADD COLUMN shot_clock_enabled INTEGER DEFAULT 0
            `);
            console.log('Migration complete: shot_clock_enabled column added');
        }
    } catch (error) {
        console.error('Error during migration:', error);
        // If migration fails, it's not critical - the column might already exist
    }

    console.log('Database initialized successfully');
}

// Initialize on module load
initDatabase();

// Database operations
const dbOps = {
    ensureApiKeyRecord(apiKey) {
        const stmt = db.prepare(`
            INSERT INTO api_keys (api_key)
            VALUES (?)
            ON CONFLICT(api_key) DO NOTHING
        `);
        stmt.run(apiKey);
    },

    // Upsert stream data (insert or update)
    upsertStream(apiKey, state) {
        const streamId = this.generateStreamId(apiKey);
        
        this.ensureApiKeyRecord(apiKey);

        const stmt = db.prepare(`
            INSERT INTO streams (
                stream_id,
                api_key,
                player1_name,
                player2_name,
                player1_enabled,
                player2_enabled,
                score_display,
                ball_tracker_enabled,
                shot_clock_enabled,
                p1_score,
                p2_score,
                game_type,
                race_info,
                game_info,
                stream_url,
                last_updated,
                is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
            ON CONFLICT(api_key) DO UPDATE SET
                player1_name = excluded.player1_name,
                player2_name = excluded.player2_name,
                player1_enabled = excluded.player1_enabled,
                player2_enabled = excluded.player2_enabled,
                score_display = excluded.score_display,
                ball_tracker_enabled = excluded.ball_tracker_enabled,
                shot_clock_enabled = excluded.shot_clock_enabled,
                p1_score = excluded.p1_score,
                p2_score = excluded.p2_score,
                game_type = excluded.game_type,
                race_info = excluded.race_info,
                game_info = excluded.game_info,
                stream_url = excluded.stream_url,
                last_updated = CURRENT_TIMESTAMP,
                is_active = 1
        `);

        try {
            stmt.run(
                streamId,
                apiKey,
                state.player1Name || '',
                state.player2Name || '',
                state.player1Enabled ? 1 : 0,
                state.player2Enabled ? 1 : 0,
                state.scoreDisplay ? 1 : 0,
                state.ballTrackerEnabled ? 1 : 0,
                state.shotClockEnabled ? 1 : 0,
                state.p1Score || 0,
                state.p2Score || 0,
                state.gameType || 'game1',
                state.raceInfo || '',
                state.gameInfo || '',
                state.streamUrl || '',
            );
            return { success: true, streamId };
        } catch (error) {
            console.error('Error upserting stream:', error);
            return { success: false, error: error.message };
        }
    },

    // Find active session for API key (if exists)
    findActiveSession(apiKey) {
        const stmt = db.prepare(`
            SELECT connection_id, connected_at
            FROM connections
            WHERE api_key = ?
            AND disconnected_at IS NULL
            ORDER BY connected_at DESC
            LIMIT 1
        `);
        
        return stmt.get(apiKey);
    },

    recordConnectionStart(apiKey) {
        this.ensureApiKeyRecord(apiKey);

        // Check if there's already an active session for this API key
        const activeSession = this.findActiveSession(apiKey);
        
        if (activeSession) {
            // Reuse existing active session (reconnection)
            // Update last_update_at to show it's still active
            const updateStmt = db.prepare(`
                UPDATE connections
                SET last_update_at = CURRENT_TIMESTAMP
                WHERE connection_id = ?
            `);
            updateStmt.run(activeSession.connection_id);
            
            console.log('SESSION_REUSED', {
                apiKey: apiKey.substring(0, 8) + '...',
                connectionId: activeSession.connection_id
            });
            
            return activeSession.connection_id;
        }

        // No active session found - create a new one
        const connectionId = `${apiKey}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

        const stmt = db.prepare(`
            INSERT INTO connections (
                connection_id,
                api_key,
                features_json
            ) VALUES (?, ?, ?)
        `);

        stmt.run(connectionId, apiKey, JSON.stringify({}));

        console.log('SESSION_CREATED', {
            apiKey: apiKey.substring(0, 8) + '...',
            connectionId: connectionId
        });

        return connectionId;
    },

    recordConnectionUpdate(connectionId, update) {
        const {
            gameType,
            streamUrl,
            scoreDisplay,
            ballTrackerEnabled,
            shotClockEnabled,
            breakingPlayerEnabled,
            ballType,
            features
        } = update;

        // Merge new features into existing features_json
        let featuresToStore = {};
        
        // Get existing features_json
        const existingFeatures = db.prepare(`
            SELECT features_json FROM connections WHERE connection_id = ?
        `).get(connectionId);
        
        let existingFeaturesObj = {};
        if (existingFeatures && existingFeatures.features_json) {
            try {
                existingFeaturesObj = JSON.parse(existingFeatures.features_json);
            } catch (e) {
                // Invalid JSON, start fresh
            }
        }
        
        // Start with existing features
        featuresToStore = { ...existingFeaturesObj };
        
        // Merge features object if provided (contains all feature flags)
        if (features) {
            featuresToStore = { ...featuresToStore, ...features };
        }
        
        // Explicitly update breakingPlayerEnabled and ballType if provided directly
        if (breakingPlayerEnabled !== undefined) {
            featuresToStore.breakingPlayerEnabled = breakingPlayerEnabled;
        }
        if (ballType !== undefined && ballType !== null && ballType !== '') {
            featuresToStore.ballType = ballType;
        }

        const stmt = db.prepare(`
            UPDATE connections
            SET
                last_game_type = COALESCE(?, last_game_type),
                last_stream_url = COALESCE(?, last_stream_url),
                used_score_display = CASE WHEN ? THEN 1 ELSE used_score_display END,
                used_ball_tracker = CASE WHEN ? THEN 1 ELSE used_ball_tracker END,
                used_shot_clock = CASE WHEN ? THEN 1 ELSE used_shot_clock END,
                total_updates = total_updates + 1,
                features_json = ?,
                last_update_at = CURRENT_TIMESTAMP
            WHERE connection_id = ?
        `);

        stmt.run(
            gameType || null,
            streamUrl || null,
            scoreDisplay ? 1 : 0,
            ballTrackerEnabled ? 1 : 0,
            shotClockEnabled ? 1 : 0,
            JSON.stringify(featuresToStore),
            connectionId
        );
    },

    finalizeConnection(connectionId) {
        const stmt = db.prepare(`
            UPDATE connections
            SET
                disconnected_at = CURRENT_TIMESTAMP,
                duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(connected_at)) * 86400 AS INTEGER)
            WHERE connection_id = ?
                AND disconnected_at IS NULL
        `);

        stmt.run(connectionId);
    },

    incrementGameTypeUsage(connectionId, gameType) {
        if (!connectionId || !gameType) {
            return;
        }

        const stmt = db.prepare(`
            INSERT INTO connection_game_types (connection_id, game_type, change_count)
            VALUES (?, ?, 1)
            ON CONFLICT(connection_id, game_type)
            DO UPDATE SET change_count = change_count + 1
        `);

        stmt.run(connectionId, gameType);
    },

    clearStatsForApiKey(apiKey) {
        const connectionIds = db.prepare(`
            SELECT connection_id
            FROM connections
            WHERE api_key = ?
        `).all(apiKey).map(row => row.connection_id);

        const deleteGameTypes = db.prepare(`
            DELETE FROM connection_game_types
            WHERE connection_id = ?
        `);

        const deleteConnection = db.prepare(`
            DELETE FROM connections
            WHERE connection_id = ?
        `);

        const transaction = db.transaction(() => {
            connectionIds.forEach(id => {
                deleteGameTypes.run(id);
                deleteConnection.run(id);
            });
        });

        transaction();
    },

    blockApiKey(apiKey, reason = null) {
        this.ensureApiKeyRecord(apiKey);

        const stmt = db.prepare(`
            UPDATE api_keys
            SET is_blocked = 1,
                blocked_reason = ?,
                blocked_at = CURRENT_TIMESTAMP
            WHERE api_key = ?
        `);

        stmt.run(reason || null, apiKey);
    },

    unblockApiKey(apiKey) {
        this.ensureApiKeyRecord(apiKey);

        const stmt = db.prepare(`
            UPDATE api_keys
            SET is_blocked = 0,
                blocked_reason = NULL,
                blocked_at = NULL
            WHERE api_key = ?
        `);

        stmt.run(apiKey);
    },

    deleteApiKey(apiKey) {
        // First clear all stats (connections, game types, streams)
        this.clearStatsForApiKey(apiKey);

        // Delete stream records
        const deleteStreams = db.prepare(`
            DELETE FROM streams WHERE api_key = ?
        `);
        deleteStreams.run(apiKey);

        // Then delete the API key record itself
        const stmt = db.prepare(`
            DELETE FROM api_keys WHERE api_key = ?
        `);
        stmt.run(apiKey);
    },

    getApiKeyStatus(apiKey) {
        this.ensureApiKeyRecord(apiKey);

        const row = db.prepare(`
            SELECT is_blocked, blocked_reason, blocked_at, created_at
            FROM api_keys
            WHERE api_key = ?
        `).get(apiKey);

        return {
            isBlocked: row ? row.is_blocked === 1 : false,
            blockedReason: row ? row.blocked_reason : null,
            blockedAt: row ? row.blocked_at : null,
            createdAt: row ? row.created_at : null
        };
    },

    isApiKeyBlocked(apiKey) {
        const status = this.getApiKeyStatus(apiKey);
        return status.isBlocked;
    },

    getStats({ search, activeApiKeys } = {}) {
        const keyMetaRows = db.prepare(`
            SELECT api_key, is_blocked, blocked_reason, blocked_at, created_at
            FROM api_keys
        `).all();

        const summaryRows = db.prepare(`
            SELECT
                api_key,
                COUNT(*) AS total_connections,
                MAX(duration_seconds) AS longest_seconds,
                AVG(duration_seconds) AS avg_seconds,
                SUM(used_score_display) AS score_sessions,
                SUM(used_ball_tracker) AS ball_tracker_sessions,
                SUM(used_shot_clock) AS shot_clock_sessions
            FROM connections
            GROUP BY api_key
        `).all();

        // Extract breaking player and ball type from features_json
        const allConnections = db.prepare(`
            SELECT api_key, features_json FROM connections
        `).all();

        const breakingPlayerMap = new Map();
        const ballTypeMap = new Map();
        
        allConnections.forEach(row => {
            const apiKey = row.api_key;
            let features = {};
            if (row.features_json) {
                try {
                    features = JSON.parse(row.features_json);
                } catch (e) {
                    // Invalid JSON, skip
                }
            }
            
            // Count breaking player usage
            if (features.breakingPlayerEnabled === true) {
                breakingPlayerMap.set(apiKey, (breakingPlayerMap.get(apiKey) || 0) + 1);
            }
            
            // Count ball type usage
            if (features.ballType) {
                if (!ballTypeMap.has(apiKey)) {
                    ballTypeMap.set(apiKey, { World: 0, International: 0 });
                }
                const counts = ballTypeMap.get(apiKey);
                if (features.ballType === 'World' || features.ballType === 'International') {
                    counts[features.ballType] = (counts[features.ballType] || 0) + 1;
                }
            }
        });

        const gameTypeRows = db.prepare(`
            SELECT c.api_key, g.game_type, SUM(g.change_count) AS total
            FROM connections c
            JOIN connection_game_types g ON g.connection_id = c.connection_id
            GROUP BY c.api_key, g.game_type
        `).all();

        const latestRows = db.prepare(`
            SELECT api_key, last_stream_url, connected_at, disconnected_at, duration_seconds
            FROM connections
            ORDER BY connected_at DESC
        `).all();

        const streamStatusRows = db.prepare(`
            SELECT
                api_key,
                MAX(is_active) AS is_active,
                MAX(last_updated) AS last_updated
            FROM streams
            GROUP BY api_key
        `).all();

        const liveConnectionRows = db.prepare(`
            SELECT api_key, connected_at
            FROM connections
            WHERE disconnected_at IS NULL
        `).all();

        const keyMetaMap = new Map(keyMetaRows.map(row => [row.api_key, row]));
        const summaryMap = new Map(summaryRows.map(row => [row.api_key, row]));

        const gameTypeMap = new Map();
        gameTypeRows.forEach(row => {
            if (!gameTypeMap.has(row.api_key)) {
                gameTypeMap.set(row.api_key, {});
            }
            gameTypeMap.get(row.api_key)[row.game_type] = row.total;
        });

        const latestMap = new Map();
        latestRows.forEach(row => {
            if (!latestMap.has(row.api_key)) {
                latestMap.set(row.api_key, row);
            }
        });

        const streamStatusMap = new Map();
        streamStatusRows.forEach(row => {
            streamStatusMap.set(row.api_key, {
                isActive: row.is_active === 1,
                lastUpdated: row.last_updated || null
            });
        });

        const liveConnectionMap = new Map();
        liveConnectionRows.forEach(row => {
            // Only mark as live if there's actually an active WebSocket connection
            const hasActiveWebSocket = activeApiKeys && activeApiKeys.has(row.api_key);
            if (hasActiveWebSocket) {
                liveConnectionMap.set(row.api_key, {
                    isLive: true,
                    connectedAt: row.connected_at || null
                });
            }
        });

        const keySet = new Set();
        keyMetaRows.forEach(row => keySet.add(row.api_key));
        summaryRows.forEach(row => keySet.add(row.api_key));
        latestRows.forEach(row => keySet.add(row.api_key));
        streamStatusRows.forEach(row => keySet.add(row.api_key));
        liveConnectionRows.forEach(row => keySet.add(row.api_key));

        const searchQuery = search ? search.toLowerCase() : null;

        const results = Array.from(keySet).sort().map(apiKey => {
            const meta = keyMetaMap.get(apiKey) || {
                api_key: apiKey,
                is_blocked: 0,
                blocked_reason: null,
                blocked_at: null,
                created_at: null
            };

            const summary = summaryMap.get(apiKey) || {};
            const totalConnections = summary.total_connections || 0;

            const latestInfo = latestMap.get(apiKey);
            const lastDurationSeconds = latestInfo && typeof latestInfo.duration_seconds === 'number' && Number.isFinite(latestInfo.duration_seconds)
                ? latestInfo.duration_seconds
                : null;
            const lastConnectionActive = Boolean(
                latestInfo
                && latestInfo.connected_at
                && (!latestInfo.disconnected_at || latestInfo.disconnected_at === null)
                && lastDurationSeconds === null
            );

            const streamStatus = streamStatusMap.get(apiKey) || { isActive: false, lastUpdated: null };
            const liveStatus = liveConnectionMap.get(apiKey) || { isLive: false, connectedAt: null };

            const entry = {
                apiKey,
                totalConnections,
                longestSeconds: summary.longest_seconds || 0,
                averageSeconds: summary.avg_seconds ? Math.round(summary.avg_seconds) : 0,
                gameTypes: gameTypeMap.get(apiKey) || {},
                latestStreamUrl: latestInfo && latestInfo.last_stream_url ? latestInfo.last_stream_url : '',
                lastDurationSeconds,
                lastConnectionActive,
                isStreaming: streamStatus.isActive,
                isLive: liveStatus.isLive,
                liveSince: liveStatus.connectedAt,
                lastStreamUpdatedAt: streamStatus.lastUpdated,
                featureUsage: {
                    scoreDisplaySessions: summary.score_sessions || 0,
                    ballTrackerSessions: summary.ball_tracker_sessions || 0,
                    shotClockSessions: summary.shot_clock_sessions || 0,
                    breakingPlayerSessions: breakingPlayerMap.get(apiKey) || 0,
                    ballType: ballTypeMap.get(apiKey) || { World: 0, International: 0 }
                },
                isBlocked: meta.is_blocked === 1,
                blockedReason: meta.blocked_reason || null,
                blockedAt: meta.blocked_at || null,
                createdAt: meta.created_at
            };

            return entry;
        });

        if (!searchQuery) {
            return results;
        }

        return results.filter(item => {
            const apiKeyMatch = item.apiKey.toLowerCase().includes(searchQuery);
            const streamMatch = item.latestStreamUrl && item.latestStreamUrl.toLowerCase().includes(searchQuery);
            return apiKeyMatch || streamMatch;
        });
    },

    getGlobalStats() {
        const aggregate = db.prepare(`
            SELECT
                COUNT(*) AS total_sessions,
                COUNT(duration_seconds) AS completed_sessions,
                AVG(duration_seconds) AS average_duration,
                MAX(duration_seconds) AS longest_duration,
                SUM(duration_seconds) AS total_duration,
                SUM(CASE WHEN used_score_display > 0 THEN 1 ELSE 0 END) AS score_sessions,
                SUM(CASE WHEN used_ball_tracker > 0 THEN 1 ELSE 0 END) AS ball_sessions,
                SUM(CASE WHEN used_shot_clock > 0 THEN 1 ELSE 0 END) AS shot_sessions
            FROM connections
        `).get();

        const totals = {
            totalSessions: aggregate && typeof aggregate.total_sessions === 'number' ? aggregate.total_sessions : 0,
            completedSessions: aggregate && typeof aggregate.completed_sessions === 'number' ? aggregate.completed_sessions : 0,
            averageDurationSeconds: aggregate && typeof aggregate.average_duration === 'number' ? aggregate.average_duration : 0,
            longestDurationSeconds: aggregate && typeof aggregate.longest_duration === 'number' ? aggregate.longest_duration : 0,
            totalDurationSeconds: aggregate && typeof aggregate.total_duration === 'number' ? aggregate.total_duration : 0,
            featureUsageCounts: {
                scoreDisplay: aggregate && typeof aggregate.score_sessions === 'number' ? aggregate.score_sessions : 0,
                ballTracker: aggregate && typeof aggregate.ball_sessions === 'number' ? aggregate.ball_sessions : 0,
                shotClock: aggregate && typeof aggregate.shot_sessions === 'number' ? aggregate.shot_sessions : 0
            }
        };

        // Extract breaking player and ball type from features_json
        const allConnectionsForGlobal = db.prepare(`
            SELECT features_json FROM connections
        `).all();

        let breakingPlayerCount = 0;
        const ballTypeCounts = { World: 0, International: 0 };
        
        allConnectionsForGlobal.forEach(row => {
            let features = {};
            if (row.features_json) {
                try {
                    features = JSON.parse(row.features_json);
                } catch (e) {
                    // Invalid JSON, skip
                }
            }
            
            if (features.breakingPlayerEnabled === true) {
                breakingPlayerCount++;
            }
            
            if (features.ballType === 'World' || features.ballType === 'International') {
                ballTypeCounts[features.ballType] = (ballTypeCounts[features.ballType] || 0) + 1;
            }
        });

        totals.featureUsageCounts.breakingPlayer = breakingPlayerCount;
        totals.featureUsageCounts.ballType = ballTypeCounts;

        const featureAdoption = {
            scoreDisplay: {
                count: totals.featureUsageCounts.scoreDisplay,
                percent: totals.totalSessions > 0
                    ? (totals.featureUsageCounts.scoreDisplay / totals.totalSessions) * 100
                    : 0
            },
            ballTracker: {
                count: totals.featureUsageCounts.ballTracker,
                percent: totals.totalSessions > 0
                    ? (totals.featureUsageCounts.ballTracker / totals.totalSessions) * 100
                    : 0
            },
            shotClock: {
                count: totals.featureUsageCounts.shotClock,
                percent: totals.totalSessions > 0
                    ? (totals.featureUsageCounts.shotClock / totals.totalSessions) * 100
                    : 0
            },
            breakingPlayer: {
                count: breakingPlayerCount,
                percent: totals.totalSessions > 0
                    ? (breakingPlayerCount / totals.totalSessions) * 100
                    : 0
            },
            ballType: ballTypeCounts
        };

        const topBySessions = db.prepare(`
            SELECT api_key, COUNT(*) AS total_connections
            FROM connections
            GROUP BY api_key
            ORDER BY total_connections DESC, api_key ASC
            LIMIT 1
        `).get();

        const topByDuration = db.prepare(`
            SELECT api_key, SUM(duration_seconds) AS total_duration
            FROM connections
            WHERE duration_seconds IS NOT NULL
            GROUP BY api_key
            ORDER BY total_duration DESC, api_key ASC
            LIMIT 1
        `).get();

        const topApiKeys = {
            mostSessions: topBySessions ? {
                apiKey: topBySessions.api_key,
                totalConnections: topBySessions.total_connections || 0
            } : null,
            longestDuration: topByDuration ? {
                apiKey: topByDuration.api_key,
                totalDurationSeconds: topByDuration.total_duration || 0
            } : null
        };

        const timeRows = db.prepare(`
            SELECT connected_at, disconnected_at
            FROM connections
            WHERE connected_at IS NOT NULL
        `).all();

        const parseTimestamp = (value) => {
            if (!value || typeof value !== 'string') {
                return null;
            }
            const normalized = value.includes('T') ? value : value.replace(' ', 'T');
            const candidate = normalized.endsWith('Z') ? normalized : `${normalized}Z`;
            const parsed = new Date(candidate);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        const now = new Date();
        const events = [];

        timeRows.forEach(row => {
            const start = parseTimestamp(row.connected_at);
            if (!start) {
                return;
            }
            events.push({ time: start.getTime(), delta: 1 });

            const end = row.disconnected_at ? parseTimestamp(row.disconnected_at) : now;
            if (end) {
                events.push({ time: end.getTime(), delta: -1 });
            }
        });

        events.sort((a, b) => {
            if (a.time !== b.time) {
                return a.time - b.time;
            }
            return a.delta - b.delta;
        });

        let concurrent = 0;
        let peakConcurrentUsers = 0;
        events.forEach(event => {
            concurrent += event.delta;
            if (concurrent > peakConcurrentUsers) {
                peakConcurrentUsers = concurrent;
            }
        });

        const sparklineRows = db.prepare(`
            SELECT strftime('%Y-%m-%d %H:00:00', connected_at) AS bucket, COUNT(*) AS sessions_started
            FROM connections
            WHERE connected_at >= datetime('now', '-23 hours')
            GROUP BY bucket
            ORDER BY bucket
        `).all();

        const sparklineMap = new Map();
        sparklineRows.forEach(row => {
            if (row.bucket) {
                sparklineMap.set(row.bucket, row.sessions_started || 0);
            }
        });

        const pad = (value) => value.toString().padStart(2, '0');

        const sparkline = [];
        for (let offset = 23; offset >= 0; offset -= 1) {
            const bucketDate = new Date(now.getTime() - offset * 3600000);
            const key = `${bucketDate.getUTCFullYear()}-${pad(bucketDate.getUTCMonth() + 1)}-${pad(bucketDate.getUTCDate())} ${pad(bucketDate.getUTCHours())}:00:00`;
            const isoBucket = `${bucketDate.toISOString().slice(0, 13)}:00:00.000Z`;
            sparkline.push({
                timestamp: isoBucket,
                sessionsStarted: sparklineMap.get(key) || 0
            });
        }

        return {
            ...totals,
            averageDurationSeconds: totals.averageDurationSeconds || 0,
            longestDurationSeconds: totals.longestDurationSeconds || 0,
            featureAdoption,
            topApiKeys,
            peakConcurrentUsers,
            sparkline,
            sparklineRangeHours: 24
        };
    },

    // Get all active streams
    getActiveStreams() {
        const stmt = db.prepare(`
            SELECT 
                stream_id,
                player1_name,
                player2_name,
                player1_enabled,
                player2_enabled,
                score_display,
                ball_tracker_enabled,
                shot_clock_enabled,
                p1_score,
                p2_score,
                game_type,
                race_info,
                game_info,
                stream_url,
                last_updated
            FROM streams
            WHERE is_active = 1
            ORDER BY last_updated DESC
        `);

        return stmt.all();
    },

    // Get stream by ID
    getStreamById(streamId) {
        const stmt = db.prepare(`
            SELECT 
                stream_id,
                player1_name,
                player2_name,
                player1_enabled,
                player2_enabled,
                score_display,
                ball_tracker_enabled,
                shot_clock_enabled,
                p1_score,
                p2_score,
                game_type,
                race_info,
                game_info,
                stream_url,
                last_updated
            FROM streams
            WHERE stream_id = ? AND is_active = 1
        `);

        return stmt.get(streamId);
    },

    // Deactivate stream (mark as inactive)
    deactivateStream(apiKey) {
        const stmt = db.prepare(`
            UPDATE streams
            SET is_active = 0
            WHERE api_key = ?
        `);

        return stmt.run(apiKey);
    },

    // Generate stream ID from API key (first 8 chars for readability)
    generateStreamId(apiKey) {
        return apiKey.substring(0, 8);
    },

    // Cleanup old inactive streams (older than 24 hours)
    cleanupOldStreams() {
        const stmt = db.prepare(`
            DELETE FROM streams
            WHERE is_active = 0
            AND last_updated < datetime('now', '-1 day')
        `);

        const result = stmt.run();
        return result.changes;
    },

    // Get streamer statistics (most streams and longest stream)
    getStreamerStats() {
        try {
            // Get API key with most sessions (matching admin backend logic)
            const mostSessionsQuery = db.prepare(`
                SELECT api_key, COUNT(*) AS total_connections
                FROM connections
                GROUP BY api_key
                ORDER BY total_connections DESC, api_key ASC
                LIMIT 1
            `).get();

            // Get the latest stream URL for the API key with most sessions
            let mostStreamsUrl = null;
            if (mostSessionsQuery && mostSessionsQuery.api_key) {
                const latestStreamQuery = db.prepare(`
                    SELECT last_stream_url
                    FROM connections
                    WHERE api_key = ? AND last_stream_url != '' AND last_stream_url IS NOT NULL
                    ORDER BY connected_at DESC
                    LIMIT 1
                `).get(mostSessionsQuery.api_key);
                mostStreamsUrl = latestStreamQuery ? latestStreamQuery.last_stream_url : null;
            }

            // Get streamer with longest stream duration (single connection)
            const longestStreamQuery = db.prepare(`
                SELECT last_stream_url, MAX(duration_seconds) as max_duration
                FROM connections
                WHERE duration_seconds IS NOT NULL 
                    AND last_stream_url != '' 
                    AND last_stream_url IS NOT NULL
                GROUP BY last_stream_url
                ORDER BY max_duration DESC
                LIMIT 1
            `).get();

            return {
                mostStreams: mostStreamsUrl,
                longestStream: longestStreamQuery ? longestStreamQuery.last_stream_url : null
            };
        } catch (error) {
            // Error is logged by the server endpoint, just return null values
            // This prevents exposing internal error details to clients
            return {
                mostStreams: null,
                longestStream: null
            };
        }
    }
};

// Cleanup old streams on startup and periodically
dbOps.cleanupOldStreams();
setInterval(() => {
    const deleted = dbOps.cleanupOldStreams();
    if (deleted > 0) {
        console.log(`Cleaned up ${deleted} old inactive streams`);
    }
}, 3600000); // Run every hour

module.exports = dbOps;

