'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = parseInt(process.env.JWT_EXPIRY || '3600', 10); // 1 hour default
const JWT_REFRESH_EXPIRY = parseInt(process.env.JWT_REFRESH_EXPIRY || '86400', 10); // 24 hours default

// In-memory session store (for production, consider Redis)
const activeSessions = new Map();

// Cleanup expired sessions every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (session.expiresAt < now) {
            activeSessions.delete(token);
        }
    }
}, 5 * 60 * 1000);

function generateTokens(ip, userAgent) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    
    // Access token (short-lived)
    const accessToken = jwt.sign(
        {
            type: 'access',
            sessionId,
            ip,
            iat: now,
            exp: now + JWT_EXPIRY
        },
        JWT_SECRET
    );
    
    // Refresh token (longer-lived)
    const refreshToken = jwt.sign(
        {
            type: 'refresh',
            sessionId,
            ip,
            iat: now,
            exp: now + JWT_REFRESH_EXPIRY
        },
        JWT_SECRET
    );
    
    // Store session
    activeSessions.set(sessionId, {
        ip,
        userAgent,
        createdAt: Date.now(),
        expiresAt: Date.now() + (JWT_REFRESH_EXPIRY * 1000),
        lastActivity: Date.now()
    });
    
    return { accessToken, refreshToken, expiresIn: JWT_EXPIRY };
}

function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check if session exists
        const session = activeSessions.get(decoded.sessionId);
        if (!session) {
            return { valid: false, reason: 'SESSION_NOT_FOUND' };
        }
        
        // Check if session expired
        if (session.expiresAt < Date.now()) {
            activeSessions.delete(decoded.sessionId);
            return { valid: false, reason: 'SESSION_EXPIRED' };
        }
        
        // Update last activity
        session.lastActivity = Date.now();
        
        return { valid: true, decoded, session };
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, reason: 'TOKEN_EXPIRED' };
        }
        if (error.name === 'JsonWebTokenError') {
            return { valid: false, reason: 'INVALID_TOKEN' };
        }
        return { valid: false, reason: 'TOKEN_ERROR', error: error.message };
    }
}

function refreshAccessToken(refreshToken, clientIP) {
    const verification = verifyToken(refreshToken);
    
    if (!verification.valid || verification.decoded.type !== 'refresh') {
        return null;
    }
    
    // Verify IP matches (prevent token theft)
    // Allow IP mismatch if both are private/localhost IPs (behind proxy scenarios)
    const tokenIP = verification.decoded.ip;
    const isPrivateIP = (ip) => {
        if (!ip || ip === 'unknown') return false;
        return ip.startsWith('127.') || 
               ip.startsWith('192.168.') || 
               ip.startsWith('10.') || 
               (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31) ||
               ip === '::1' ||
               ip.startsWith('::ffff:127.') ||
               ip.startsWith('::ffff:192.168.') ||
               ip.startsWith('::ffff:10.');
    };
    
    // Only enforce IP check if not both private IPs
    if (tokenIP !== clientIP && !(isPrivateIP(tokenIP) && isPrivateIP(clientIP))) {
        return null;
    }
    
    // Generate new access token
    const now = Math.floor(Date.now() / 1000);
    const accessToken = jwt.sign(
        {
            type: 'access',
            sessionId: verification.decoded.sessionId,
            ip: clientIP,
            iat: now,
            exp: now + JWT_EXPIRY
        },
        JWT_SECRET
    );
    
    return { accessToken, expiresIn: JWT_EXPIRY };
}

function revokeSession(token) {
    try {
        const decoded = jwt.decode(token);
        if (decoded && decoded.sessionId) {
            activeSessions.delete(decoded.sessionId);
            return true;
        }
    } catch (error) {
        // Ignore
    }
    return false;
}

function revokeAllSessions() {
    activeSessions.clear();
}

module.exports = {
    generateTokens,
    verifyToken,
    refreshAccessToken,
    revokeSession,
    revokeAllSessions,
    JWT_EXPIRY
};

