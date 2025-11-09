'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const dbOps = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const app = express();
function getAdminPasswordFromRequest(req) {
    if (req.headers['x-admin-password']) {
        return req.headers['x-admin-password'];
    }
    if (req.body && typeof req.body.password === 'string') {
        return req.body.password;
    }
    if (req.query && typeof req.query.password === 'string') {
        return req.query.password;
    }
    return null;
}

function requireAdminAuth(req, res, next) {
    if (!ADMIN_PASSWORD) {
        return res.status(500).json({
            success: false,
            error: 'Admin password is not configured on the server.'
        });
    }

    const provided = getAdminPasswordFromRequest(req);

    if (!provided || provided !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
    }

    next();
}


// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Explicit favicon route to ensure it's served
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Content-Type', 'image/x-icon');
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve statistics dashboard
app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

// Rate limiting map (simple in-memory rate limiter)
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 updates per minute

function checkRateLimit(apiKey) {
    const now = Date.now();
    const key = apiKey;

    if (!rateLimiter.has(key)) {
        rateLimiter.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }

    const limit = rateLimiter.get(key);

    if (now > limit.resetTime) {
        limit.count = 1;
        limit.resetTime = now + RATE_LIMIT_WINDOW;
        return true;
    }

    if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }

    limit.count++;
    return true;
}

// Sanitize input to prevent injection
function sanitizeInput(input) {
    if (typeof input === 'string') {
        // Remove control characters and limit length
        return input
            .replace(/[\x00-\x1F\x7F]/g, '')
            .substring(0, 100);
    }
    return input;
}

// Sanitize game state
function sanitizeState(state) {
    const normalizeEnabled = (value) => {
        if (value === null || value === undefined) return true;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'no' || normalized === 'false' || normalized === '0' || normalized === 'disabled') {
                return false;
            }
            if (normalized === 'yes' || normalized === 'true' || normalized === '1' || normalized === 'enabled') {
                return true;
            }
        }
        return true;
    };

    const normalizeBoolean = (value, defaultValue = false) => {
        if (value === null || value === undefined) return defaultValue;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['yes', 'true', '1', 'enabled', 'on'].includes(normalized)) {
                return true;
            }
            if (['no', 'false', '0', 'disabled', 'off'].includes(normalized)) {
                return false;
            }
        }
        return defaultValue;
    };

    // Sanitize URL
    let streamUrl = '';
    if (state.streamUrl && typeof state.streamUrl === 'string') {
        try {
            const url = new URL(state.streamUrl);
            // Only allow http/https URLs
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                streamUrl = state.streamUrl.substring(0, 500); // Limit length
            }
        } catch (e) {
            // Invalid URL, ignore
            streamUrl = '';
        }
    }
    
    return {
        player1Name: sanitizeInput(state.player1Name || ''),
        player2Name: sanitizeInput(state.player2Name || ''),
        p1Score: Math.max(0, Math.min(999, parseInt(state.p1Score) || 0)),
        p2Score: Math.max(0, Math.min(999, parseInt(state.p2Score) || 0)),
        gameType: sanitizeInput(state.gameType || 'game1'),
        raceInfo: sanitizeInput(state.raceInfo || ''),
        gameInfo: sanitizeInput(state.gameInfo || ''),
        streamUrl: streamUrl,
        player1Enabled: normalizeEnabled(state.player1Enabled ?? state.usePlayer1),
        player2Enabled: normalizeEnabled(state.player2Enabled ?? state.usePlayer2),
        scoreDisplay: normalizeBoolean(state.scoreDisplay ?? state.useScoreDisplay ?? state.scoreVisible, true),
        ballTrackerEnabled: normalizeBoolean(state.ballTrackerEnabled ?? state.enableBallTracker),
        shotClockEnabled: normalizeBoolean(state.shotClockEnabled ?? state.useClock),
        breakingPlayerEnabled: normalizeBoolean(state.breakingPlayerEnabled ?? state.usePlayerToggle),
        ballType: sanitizeInput(state.ballType || ''),
        timestamp: new Date().toISOString()
    };
}

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server,
    path: '/ws'
});

// Track active connections by API key
const activeConnections = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    let apiKey = null;
    let isAuthenticated = false;

    console.log('New WebSocket connection');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            // First message should be authentication
            if (!isAuthenticated) {
                if (data.type === 'auth' && data.api_key) {
                    apiKey = data.api_key.trim();

                    // Validate API key format (should be a hex string, at least 16 chars)
                    if (!/^[a-f0-9]{16,}$/i.test(apiKey)) {
                        ws.send(JSON.stringify({
                            type: 'auth',
                            status: 'error',
                            message: 'Invalid API key format'
                        }));
                        ws.close();
                        return;
                    }

                    const keyStatus = dbOps.getApiKeyStatus(apiKey);

                    if (keyStatus.isBlocked) {
                        ws.send(JSON.stringify({
                            type: 'auth',
                            status: 'blocked',
                            message: keyStatus.blockedReason || 'API key is blocked by administrator'
                        }));
                        ws.close();
                        return;
                    }

                    isAuthenticated = true;

                    const existingConnection = activeConnections.get(apiKey);
                    if (existingConnection && existingConnection.ws !== ws) {
                        try {
                            existingConnection.ws.close(4002, 'Superseded by new connection');
                        } catch (closeError) {
                            console.warn('Failed to close superseded connection:', closeError);
                        }

                        try {
                            dbOps.finalizeConnection(existingConnection.connectionId);
                        } catch (finalizeError) {
                            console.warn('Failed to finalize superseded connection:', finalizeError);
                        }
                    }

                    const connectionId = dbOps.recordConnectionStart(apiKey);

                    activeConnections.set(apiKey, {
                        ws,
                        connectionId,
                        currentGameType: null,
                        lastUpdate: Date.now(),
                        features: {
                            player1Enabled: false,
                            player2Enabled: false,
                            scoreDisplay: false,
                            ballTrackerEnabled: false,
                            shotClockEnabled: false
                        }
                    });

                    ws.send(JSON.stringify({
                        type: 'auth',
                        status: 'success',
                        message: 'Authenticated'
                    }));

                    console.log(`Client authenticated: ${apiKey.substring(0, 8)}...`);
                } else {
                    ws.send(JSON.stringify({
                        type: 'auth',
                        status: 'error',
                        message: 'Authentication required'
                    }));
                    ws.close();
                }
                return;
            }

            // Handle update messages
            if (data.type === 'update' && data.state) {
                // Rate limiting
                if (!checkRateLimit(apiKey)) {
                    ws.send(JSON.stringify({
                        type: 'ack',
                        status: 'error',
                        message: 'Rate limit exceeded'
                    }));
                    return;
                }

                // Sanitize and validate state
                const sanitizedState = sanitizeState(data.state);

                const connectionInfo = activeConnections.get(apiKey);

                if (connectionInfo) {
                    const featureSnapshot = {
                        player1Enabled: sanitizedState.player1Enabled,
                        player2Enabled: sanitizedState.player2Enabled,
                        scoreDisplay: sanitizedState.scoreDisplay,
                        ballTrackerEnabled: sanitizedState.ballTrackerEnabled,
                        shotClockEnabled: sanitizedState.shotClockEnabled,
                        breakingPlayerEnabled: sanitizedState.breakingPlayerEnabled,
                        ballType: sanitizedState.ballType
                    };

                    dbOps.recordConnectionUpdate(connectionInfo.connectionId, {
                        gameType: sanitizedState.gameType,
                        streamUrl: sanitizedState.streamUrl,
                        scoreDisplay: sanitizedState.scoreDisplay,
                        ballTrackerEnabled: sanitizedState.ballTrackerEnabled,
                        shotClockEnabled: sanitizedState.shotClockEnabled,
                        breakingPlayerEnabled: sanitizedState.breakingPlayerEnabled,
                        ballType: sanitizedState.ballType,
                        features: featureSnapshot
                    });

                    if (sanitizedState.gameType && sanitizedState.gameType !== connectionInfo.currentGameType) {
                        dbOps.incrementGameTypeUsage(connectionInfo.connectionId, sanitizedState.gameType);
                        connectionInfo.currentGameType = sanitizedState.gameType;
                    }

                    connectionInfo.lastUpdate = Date.now();
                    connectionInfo.features = featureSnapshot;
                }

                // Update database
                const result = dbOps.upsertStream(apiKey, sanitizedState);

                if (result.success) {
                    ws.send(JSON.stringify({
                        type: 'ack',
                        status: 'success',
                        message: 'Update received'
                    }));

                    // Broadcast to all viewing clients (could add separate channel for viewers)
                    // For now, just log success
                    console.log(`Stream updated: ${apiKey.substring(0, 8)}...`);
                } else {
                    ws.send(JSON.stringify({
                        type: 'ack',
                        status: 'error',
                        message: 'Failed to update stream'
                    }));
                }
            } else if (data.type === 'ping') {
                // Heartbeat/ping
                ws.send(JSON.stringify({
                    type: 'pong'
                }));
            }

        } catch (error) {
            console.error('WebSocket message error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                status: 'error',
                message: 'Invalid message format'
            }));
        }
    });

    ws.on('close', () => {
        if (apiKey) {
            const connectionInfo = activeConnections.get(apiKey);
            const isCurrentConnection = connectionInfo && connectionInfo.ws === ws;

            if (isCurrentConnection) {
                try {
                    dbOps.finalizeConnection(connectionInfo.connectionId);
                } catch (error) {
                    console.warn('Failed to finalize connection on close:', error);
                }

                activeConnections.delete(apiKey);

                const closedWs = ws;
                // Mark stream as inactive after a delay (in case of temporary disconnect)
                setTimeout(() => {
                    const current = activeConnections.get(apiKey);
                    if (!current || current.ws === closedWs) {
                        dbOps.deactivateStream(apiKey);
                        console.log(`Stream deactivated: ${apiKey.substring(0, 8)}...`);
                    }
                }, 60000); // 1 minute grace period
            }
        }
        console.log('WebSocket connection closed');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (apiKey) {
            const connectionInfo = activeConnections.get(apiKey);
            if (connectionInfo && connectionInfo.ws === ws) {
                try {
                    dbOps.finalizeConnection(connectionInfo.connectionId);
                } catch (finalizeError) {
                    console.warn('Failed to finalize connection on error:', finalizeError);
                }
                activeConnections.delete(apiKey);
            }
        }
    });

    // Send authentication request
    ws.send(JSON.stringify({
        type: 'auth',
        status: 'pending',
        message: 'Please authenticate with your API key'
    }));

    // Set timeout for authentication (30 seconds)
    const authTimeout = setTimeout(() => {
        if (!isAuthenticated) {
            ws.close();
        }
    }, 30000);

    ws.on('message', () => {
        if (isAuthenticated) {
            clearTimeout(authTimeout);
        }
    });
});

// REST API Endpoints

// Get all active streams
app.get('/api/streams', (req, res) => {
    try {
        const streams = dbOps.getActiveStreams();
        res.json({
            success: true,
            count: streams.length,
            streams: streams.map(stream => ({
                id: stream.stream_id,
                player1Name: stream.player1_name,
                player2Name: stream.player2_name,
                player1Enabled: stream.player1_enabled ? true : false,
                player2Enabled: stream.player2_enabled ? true : false,
                scoreDisplay: stream.score_display ? true : false,
                ballTrackerEnabled: stream.ball_tracker_enabled ? true : false,
                shotClockEnabled: stream.shot_clock_enabled ? true : false,
                p1Score: stream.p1_score,
                p2Score: stream.p2_score,
                gameType: stream.game_type,
                raceInfo: stream.race_info,
                gameInfo: stream.game_info,
                streamUrl: stream.stream_url || '',
                lastUpdated: stream.last_updated
            }))
        });
    } catch (error) {
        console.error('Error fetching streams:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch streams'
        });
    }
});

// Admin routes
app.get('/api/admin/stats', requireAdminAuth, (req, res) => {
    try {
        const search = typeof req.query.search === 'string' && req.query.search.trim() !== ''
            ? req.query.search.trim()
            : undefined;

        // Get list of API keys that actually have active WebSocket connections
        const activeApiKeys = new Set();
        activeConnections.forEach((connectionInfo, apiKey) => {
            if (connectionInfo.ws && connectionInfo.ws.readyState === WebSocket.OPEN) {
                activeApiKeys.add(apiKey);
            }
        });

        const stats = dbOps.getStats({ search, activeApiKeys });
        const globalStats = dbOps.getGlobalStats();

        res.json({
            success: true,
            stats,
            global: globalStats
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics'
        });
    }
});

app.post('/api/admin/block', requireAdminAuth, (req, res) => {
    const apiKey = (req.body && typeof req.body.apiKey === 'string') ? req.body.apiKey.trim() : '';
    const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : null;

    if (!apiKey) {
        return res.status(400).json({
            success: false,
            error: 'apiKey is required'
        });
    }

    try {
        dbOps.blockApiKey(apiKey, reason);

        const session = activeConnections.get(apiKey);
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.close(4001, 'API key blocked by administrator');
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error blocking API key:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to block API key'
        });
    }
});

app.post('/api/admin/unblock', requireAdminAuth, (req, res) => {
    const apiKey = (req.body && typeof req.body.apiKey === 'string') ? req.body.apiKey.trim() : '';

    if (!apiKey) {
        return res.status(400).json({
            success: false,
            error: 'apiKey is required'
        });
    }

    try {
        dbOps.unblockApiKey(apiKey);
        res.json({ success: true });
    } catch (error) {
        console.error('Error unblocking API key:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to unblock API key'
        });
    }
});

app.post('/api/admin/clear', requireAdminAuth, (req, res) => {
    const apiKey = (req.body && typeof req.body.apiKey === 'string') ? req.body.apiKey.trim() : '';

    if (!apiKey) {
        return res.status(400).json({
            success: false,
            error: 'apiKey is required'
        });
    }

    try {
        dbOps.clearStatsForApiKey(apiKey);
        res.json({ success: true });
    } catch (error) {
        console.error('Error clearing stats for API key:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear statistics for API key'
        });
    }
});


// Get specific stream by ID
app.get('/api/streams/:id', (req, res) => {
    try {
        const stream = dbOps.getStreamById(req.params.id);
        
        if (!stream) {
            return res.status(404).json({
                success: false,
                error: 'Stream not found'
            });
        }

        res.json({
            success: true,
            stream: {
                id: stream.stream_id,
                player1Name: stream.player1_name,
                player2Name: stream.player2_name,
                player1Enabled: stream.player1_enabled ? true : false,
                player2Enabled: stream.player2_enabled ? true : false,
                scoreDisplay: stream.score_display ? true : false,
                ballTrackerEnabled: stream.ball_tracker_enabled ? true : false,
                shotClockEnabled: stream.shot_clock_enabled ? true : false,
                p1Score: stream.p1_score,
                p2Score: stream.p2_score,
                gameType: stream.game_type,
                raceInfo: stream.race_info,
                gameInfo: stream.game_info,
                streamUrl: stream.stream_url || '',
                lastUpdated: stream.last_updated
            }
        });
    } catch (error) {
        console.error('Error fetching stream:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stream'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeConnections: activeConnections.size
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
    console.log(`REST API: http://localhost:${PORT}/api/streams`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    wss.close(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    wss.close(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
});

