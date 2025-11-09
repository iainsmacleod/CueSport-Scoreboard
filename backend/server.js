'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dns = require('dns').promises;
const dbOps = require('./db');
const { logger, securityLogger } = require('./logger');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

// Security configuration
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP || '5', 10);
const MAX_TOTAL_CONNECTIONS = parseInt(process.env.MAX_TOTAL_CONNECTIONS || '1000', 10);
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10); // 30 seconds

// Admin IP whitelist configuration (supports IPs, CIDR, and domains)
const ADMIN_IP_WHITELIST = process.env.ADMIN_IP_WHITELIST 
    ? process.env.ADMIN_IP_WHITELIST.split(',').map(ip => ip.trim())
    : []; // Empty array means IP whitelisting is disabled

// Cache for domain-to-IP resolutions (to avoid repeated DNS lookups)
const domainIPCache = new Map();
const DNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper function to check if a string is an IP address
function isIPAddress(str) {
    // Check for IPv4 (simple check)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    // Check for IPv6 (simplified)
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(\/\d{1,3})?$/;
    return ipv4Regex.test(str) || ipv6Regex.test(str);
}

// Helper function to resolve domain to IP addresses
async function resolveDomainToIPs(domain) {
    // Check cache first
    const cached = domainIPCache.get(domain);
    if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
        return cached.ips;
    }

    try {
        // Resolve domain to IPv4 addresses
        const ips = await dns.resolve4(domain);
        // Cache the result
        domainIPCache.set(domain, {
            ips: ips,
            timestamp: Date.now()
        });
        return ips;
    } catch (error) {
        logger.warn(`Failed to resolve domain ${domain}:`, error.message);
        // Cache negative result for shorter time (1 minute)
        domainIPCache.set(domain, {
            ips: [],
            timestamp: Date.now() - (DNS_CACHE_TTL - 60000)
        });
        return [];
    }
}

const app = express();

// Helper function to get client IP (used for IP whitelisting and logging)
function getClientIP(req) {
    // Check multiple headers that proxies might use
    const forwardedFor = req.headers['x-forwarded-for'];
    const realIP = req.headers['x-real-ip'];
    const cfConnectingIP = req.headers['cf-connecting-ip']; // Cloudflare
    const trueClientIP = req.headers['true-client-ip']; // Some proxies
    
    // Priority: Cloudflare IP, then X-Forwarded-For, then X-Real-IP, then socket
    if (cfConnectingIP) return cfConnectingIP.trim();
    if (trueClientIP) return trueClientIP.trim();
    if (forwardedFor) {
        // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        // Take the first one (original client)
        return forwardedFor.split(',')[0].trim();
    }
    if (realIP) return realIP.trim();
    
    // Fallback to socket address (might be proxy IP if behind reverse proxy)
    const socketIP = req.socket.remoteAddress;
    if (socketIP) {
        // Remove IPv6 prefix if present
        return socketIP.replace(/^::ffff:/, '');
    }
    
    return 'unknown';
}

// Helper function to check if an IP is a private/localhost IP
function isPrivateIP(ip) {
    if (!ip || ip === 'unknown') return false;
    // Check for localhost/private IPs
    return ip.startsWith('127.') || 
           ip.startsWith('192.168.') || 
           ip.startsWith('10.') || 
           (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31) ||
           ip === '::1' ||
           ip.startsWith('::ffff:127.') ||
           ip.startsWith('::ffff:192.168.') ||
           ip.startsWith('::ffff:10.');
}

// Helper function to check IP whitelist (used by both login and requireAdminAuth)
async function checkIPWhitelist(clientIP) {
    if (ADMIN_IP_WHITELIST.length === 0) {
        return true; // No whitelist configured
    }

    let isWhitelisted = false;

    // Check each entry in the whitelist
    for (const whitelistEntry of ADMIN_IP_WHITELIST) {
        // Check if it's a domain (not an IP address)
        if (!isIPAddress(whitelistEntry)) {
            // It's a domain - resolve it and check if client IP matches
            try {
                const resolvedIPs = await resolveDomainToIPs(whitelistEntry);
                if (resolvedIPs.includes(clientIP)) {
                    isWhitelisted = true;
                    break;
                }
            } catch (error) {
                logger.warn(`Error resolving domain ${whitelistEntry}:`, error.message);
                // Continue to next entry if domain resolution fails
            }
        } else {
            // It's an IP address or CIDR notation
            if (whitelistEntry.includes('/')) {
                // CIDR notation check
                const [network, prefix] = whitelistEntry.split('/');
                const prefixLength = parseInt(prefix, 10);
                const networkParts = network.split('.').map(Number);
                const clientParts = clientIP.split('.').map(Number);
                
                if (prefixLength === 24) {
                    if (networkParts[0] === clientParts[0] &&
                        networkParts[1] === clientParts[1] &&
                        networkParts[2] === clientParts[2]) {
                        isWhitelisted = true;
                        break;
                    }
                } else if (prefixLength === 16) {
                    if (networkParts[0] === clientParts[0] &&
                        networkParts[1] === clientParts[1]) {
                        isWhitelisted = true;
                        break;
                    }
                } else if (prefixLength === 8) {
                    if (networkParts[0] === clientParts[0]) {
                        isWhitelisted = true;
                        break;
                    }
                } else {
                    // For other CIDR, do exact match on first N bits (simplified)
                    if (network === clientIP) {
                        isWhitelisted = true;
                        break;
                    }
                }
            } else {
                // Exact IP match
                if (whitelistEntry === clientIP) {
                    isWhitelisted = true;
                    break;
                }
            }
        }
    }

    return isWhitelisted;
}

async function requireAdminAuth(req, res, next) {
    const clientIP = getClientIP(req);
    
    // Get token from Authorization header or body
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : req.body?.token;
    
    if (!token) {
        securityLogger.logAccessDenied(clientIP, 'NO_TOKEN', req.path);
        return res.status(401).json({
            success: false,
            error: 'Authentication token required'
        });
    }
    
    const verification = auth.verifyToken(token);
    
    if (!verification.valid) {
        logger.warn('TOKEN_VALIDATION_FAILED', {
            ip: clientIP,
            path: req.path,
            reason: verification.reason,
            tokenPrefix: token.substring(0, 20) + '...'
        });
        securityLogger.logAccessDenied(clientIP, verification.reason, req.path);
        return res.status(401).json({
            success: false,
            error: `Invalid or expired token: ${verification.reason}`
        });
    }
    
    // Verify IP matches (prevent token theft)
    // Allow IP mismatch if both are private/localhost IPs (behind proxy scenarios)
    const tokenIP = verification.decoded.ip;
    const isIPMismatch = tokenIP !== clientIP;
    
    // Only enforce IP check if not both private IPs (more lenient for proxy scenarios)
    if (isIPMismatch && !(isPrivateIP(tokenIP) && isPrivateIP(clientIP))) {
        securityLogger.logSuspiciousActivity(clientIP, 'IP_MISMATCH', {
            expectedIP: tokenIP,
            actualIP: clientIP
        });
        return res.status(401).json({
            success: false,
            error: `Token IP mismatch. Token IP: ${tokenIP}, Request IP: ${clientIP}`
        });
    }
    
    // Attach session info to request
    req.session = verification.session;
    req.sessionId = verification.decoded.sessionId;
    
    next();
}


// Security: Trust proxy if behind reverse proxy (nginx, etc.)
app.set('trust proxy', 1);

// Security headers with helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Simple CORS - allow all origins (since WebSocket/direct API bypass CORS anyway)
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    const clientIP = getClientIP(req);
    
    // Log request
    logger.info('HTTP_REQUEST', {
        method: req.method,
        path: req.path,
        ip: clientIP,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString()
    });
    
    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('HTTP_RESPONSE', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: clientIP,
            timestamp: new Date().toISOString()
        });
    });
    
    next();
});

// Request size limits to prevent abuse
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// REST API rate limiting (separate from WebSocket rate limiting)
const restApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health check endpoint
        return req.path === '/health';
    },
    handler: (req, res) => {
        const clientIP = getClientIP(req);
        securityLogger.logRateLimit(clientIP, req.path);
        res.status(429).json({
            success: false,
            error: 'Too many requests, please try again later.'
        });
    }
});

// Apply rate limiting to REST API
app.use('/api/', restApiLimiter);

// Admin endpoints rate limiting - separate limits for different operations
// Login endpoint: More lenient (brute force protection)
const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 login attempts per 15 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful logins
    handler: (req, res) => {
        const clientIP = getClientIP(req);
        securityLogger.logRateLimit(clientIP, req.path);
        res.status(429).json({
            success: false,
            error: 'Too many login attempts, please try again later.'
        });
    }
});

// Stats endpoint: More lenient (for auto-refresh)
const adminStatsLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 stats requests per minute per IP (allows auto-refresh every 2 seconds if needed)
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const clientIP = getClientIP(req);
        securityLogger.logRateLimit(clientIP, req.path);
        res.status(429).json({
            success: false,
            error: 'Too many stats requests, please slow down.'
        });
    }
});

// Admin actions (delete, block, unblock, clear): Stricter limit
const adminActionLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 actions per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const clientIP = getClientIP(req);
        securityLogger.logRateLimit(clientIP, req.path);
        res.status(429).json({
            success: false,
            error: 'Too many admin actions, please slow down.'
        });
    }
});

// Token refresh: Moderate limit
const adminRefreshLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 refresh requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        const clientIP = getClientIP(req);
        securityLogger.logRateLimit(clientIP, req.path);
        res.status(429).json({
            success: false,
            error: 'Too many token refresh requests, please try again later.'
        });
    }
});

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

// Create HTTP server with request timeout
const server = http.createServer(app);

// Security: Set server timeout to prevent hanging connections
server.timeout = REQUEST_TIMEOUT;
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server,
    path: '/ws'
});

// Track active connections by API key
const activeConnections = new Map();

// Track connections per IP address
const ipConnectionCount = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    let apiKey = null;
    let isAuthenticated = false;
    const clientIP = getClientIP(req);

    // Security: Check total connections limit
    if (wss.clients.size >= MAX_TOTAL_CONNECTIONS) {
        securityLogger.logConnectionLimit(clientIP, 'TOTAL_CONNECTIONS');
        ws.close(1008, 'Server at capacity');
        return;
    }

    // Security: Check per-IP connection limit
    const ipCount = ipConnectionCount.get(clientIP) || 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
        securityLogger.logConnectionLimit(clientIP, 'PER_IP_CONNECTIONS');
        ws.close(1008, 'Too many connections from this IP');
        return;
    }
    
    // Increment IP connection count
    ipConnectionCount.set(clientIP, ipCount + 1);

    logger.info('WEBSOCKET_CONNECTION', {
        ip: clientIP,
        totalConnections: wss.clients.size
    });

    // Security: Set message size limit (prevent large payload attacks)
    const MAX_MESSAGE_SIZE = 10240; // 10KB max message size
    
    ws.on('message', (message) => {
        // Security: Check message size
        if (message.length > MAX_MESSAGE_SIZE) {
            securityLogger.logSuspiciousActivity(clientIP, 'MESSAGE_TOO_LARGE', { size: message.length });
            ws.send(JSON.stringify({
                type: 'error',
                status: 'error',
                message: 'Message too large'
            }));
            ws.close(1009, 'Message too large');
            return;
        }

        try {
            const data = JSON.parse(message.toString());

            // First message should be authentication
            if (!isAuthenticated) {
                if (data.type === 'auth' && data.api_key) {
                    apiKey = data.api_key.trim();

                    // Validate API key format (should be a hex string, at least 16 chars)
                    if (!/^[a-f0-9]{16,}$/i.test(apiKey)) {
                        securityLogger.logSuspiciousActivity(clientIP, 'INVALID_API_KEY_FORMAT', { apiKey: apiKey.substring(0, 8) });
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
                        securityLogger.logApiKeyBlocked(apiKey, keyStatus.blockedReason);
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
                            logger.warn('FAILED_TO_CLOSE_CONNECTION', { error: closeError.message });
                        }

                        try {
                            dbOps.finalizeConnection(existingConnection.connectionId);
                        } catch (finalizeError) {
                            logger.warn('FAILED_TO_FINALIZE_CONNECTION', { error: finalizeError.message });
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

                    logger.info('WEBSOCKET_AUTHENTICATED', {
                        apiKey: apiKey.substring(0, 8) + '...',
                        ip: clientIP
                    });
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
                    logger.debug('STREAM_UPDATED', {
                        apiKey: apiKey.substring(0, 8) + '...'
                    });
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
            logger.error('WEBSOCKET_MESSAGE_ERROR', {
                error: error.message,
                stack: error.stack,
                ip: clientIP
            });
            ws.send(JSON.stringify({
                type: 'error',
                status: 'error',
                message: 'Invalid message format'
            }));
        }
    });

    ws.on('close', () => {
        // Decrement IP connection count
        const currentIpCount = ipConnectionCount.get(clientIP) || 0;
        if (currentIpCount > 0) {
            ipConnectionCount.set(clientIP, currentIpCount - 1);
            if (currentIpCount === 1) {
                ipConnectionCount.delete(clientIP);
            }
        }

        if (apiKey) {
            const connectionInfo = activeConnections.get(apiKey);
            const isCurrentConnection = connectionInfo && connectionInfo.ws === ws;

            if (isCurrentConnection) {
                try {
                    dbOps.finalizeConnection(connectionInfo.connectionId);
                } catch (error) {
                    logger.warn('FAILED_TO_FINALIZE_CONNECTION_CLOSE', { error: error.message });
                }

                activeConnections.delete(apiKey);

                const closedWs = ws;
                // Mark stream as inactive after a delay (in case of temporary disconnect)
                setTimeout(() => {
                    const current = activeConnections.get(apiKey);
                    if (!current || current.ws === closedWs) {
                        dbOps.deactivateStream(apiKey);
                        logger.info('STREAM_DEACTIVATED', {
                            apiKey: apiKey.substring(0, 8) + '...'
                        });
                    }
                }, 60000); // 1 minute grace period
            }
        }
        logger.info('WEBSOCKET_CLOSED', { ip: clientIP });
    });

    ws.on('error', (error) => {
        logger.error('WEBSOCKET_ERROR', {
            error: error.message,
            ip: clientIP
        });
        
        // Decrement IP connection count on error
        const currentIpCount = ipConnectionCount.get(clientIP) || 0;
        if (currentIpCount > 0) {
            ipConnectionCount.set(clientIP, currentIpCount - 1);
            if (currentIpCount === 1) {
                ipConnectionCount.delete(clientIP);
            }
        }
        
        if (apiKey) {
            const connectionInfo = activeConnections.get(apiKey);
            if (connectionInfo && connectionInfo.ws === ws) {
                try {
                    dbOps.finalizeConnection(connectionInfo.connectionId);
                } catch (finalizeError) {
                    logger.warn('FAILED_TO_FINALIZE_CONNECTION_ERROR', { error: finalizeError.message });
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
        logger.error('ERROR_FETCHING_STREAMS', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch streams'
        });
    }
});

// Admin authentication endpoints
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    if (!ADMIN_PASSWORD) {
        logger.error('ADMIN_PASSWORD_NOT_CONFIGURED', {
            ip: clientIP,
            endpoint: '/api/admin/login'
        });
        return res.status(500).json({
            success: false,
            error: 'Admin password is not configured.'
        });
    }
    
    // IP whitelisting check (if configured)
    const isWhitelisted = await checkIPWhitelist(clientIP);
    if (!isWhitelisted) {
        securityLogger.logAccessDenied(clientIP, 'IP_NOT_WHITELISTED', '/api/admin/login');
        return res.status(403).json({
            success: false,
            error: 'Access denied: IP not whitelisted'
        });
    }
    
    const { password } = req.body;
    
    if (!password || password !== ADMIN_PASSWORD) {
        securityLogger.logAuthAttempt(clientIP, false, 'INVALID_PASSWORD');
        return res.status(401).json({
            success: false,
            error: 'Invalid password'
        });
    }
    
    // Generate tokens
    const tokens = auth.generateTokens(clientIP, userAgent);
    securityLogger.logAuthAttempt(clientIP, true);
    
    res.json({
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn
    });
});

// Token refresh endpoint
app.post('/api/admin/refresh', adminRefreshLimiter, (req, res) => {
    const clientIP = getClientIP(req);
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
        return res.status(400).json({
            success: false,
            error: 'Refresh token required'
        });
    }
    
    const newTokens = auth.refreshAccessToken(refreshToken, clientIP);
    
    if (!newTokens) {
        securityLogger.logAccessDenied(clientIP, 'INVALID_REFRESH_TOKEN', '/api/admin/refresh');
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired refresh token'
        });
    }
    
    res.json({
        success: true,
        accessToken: newTokens.accessToken,
        expiresIn: newTokens.expiresIn
    });
});

// Logout endpoint
app.post('/api/admin/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : req.body?.token;
    
    if (token) {
        auth.revokeSession(token);
    }
    
    res.json({ success: true });
});

// Admin routes
app.get('/api/admin/stats', adminStatsLimiter, requireAdminAuth, (req, res) => {
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
        logger.error('ERROR_FETCHING_ADMIN_STATS', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics'
        });
    }
});

app.post('/api/admin/block', adminActionLimiter, requireAdminAuth, (req, res) => {
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
        logger.error('ERROR_BLOCKING_API_KEY', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to block API key'
        });
    }
});

app.post('/api/admin/unblock', adminActionLimiter, requireAdminAuth, (req, res) => {
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
        logger.error('ERROR_UNBLOCKING_API_KEY', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to unblock API key'
        });
    }
});

app.post('/api/admin/clear', adminActionLimiter, requireAdminAuth, (req, res) => {
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
        logger.error('ERROR_CLEARING_STATS', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to clear statistics for API key'
        });
    }
});

app.post('/api/admin/delete', adminActionLimiter, requireAdminAuth, (req, res) => {
    const apiKey = (req.body && typeof req.body.apiKey === 'string') ? req.body.apiKey.trim() : '';

    if (!apiKey) {
        return res.status(400).json({
            success: false,
            error: 'apiKey is required'
        });
    }

    try {
        // Close any active WebSocket connections for this API key
        const session = activeConnections.get(apiKey);
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.close(4003, 'API key deleted by administrator');
        }
        activeConnections.delete(apiKey);

        // Delete the API key and all associated data
        dbOps.deleteApiKey(apiKey);
        
        res.json({ success: true });
    } catch (error) {
        logger.error('ERROR_DELETING_API_KEY', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to delete API key'
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
        logger.error('ERROR_FETCHING_STREAM', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stream'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    const clientIP = getClientIP(req);
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeConnections: activeConnections.size,
        clientIP: clientIP, // Show detected IP for debugging
        ipWhitelistConfigured: ADMIN_IP_WHITELIST.length > 0,
        ipWhitelist: ADMIN_IP_WHITELIST.length > 0 ? ADMIN_IP_WHITELIST : null
    });
});

// Start server
server.listen(PORT, () => {
    logger.info('SERVER_STARTED', {
        port: PORT,
        websocketEndpoint: `ws://localhost:${PORT}/ws`,
        restAPI: `http://localhost:${PORT}/api/streams`
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM_RECEIVED', { message: 'Closing server...' });
    wss.close(() => {
        server.close(() => {
            logger.info('SERVER_CLOSED', { message: 'Server closed gracefully' });
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT_RECEIVED', { message: 'Closing server...' });
    wss.close(() => {
        server.close(() => {
            logger.info('SERVER_CLOSED', { message: 'Server closed gracefully' });
            process.exit(0);
        });
    });
});

