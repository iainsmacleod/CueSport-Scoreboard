'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for structured logging
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format (more readable)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
    })
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'cuesport-backend' },
    transports: [
        // Error log file (errors only)
        new DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        }),
        // Combined log file (all levels)
        new DailyRotateFile({
            filename: path.join(logsDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        }),
        // Security events log (security-related events)
        new DailyRotateFile({
            filename: path.join(logsDir, 'security-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'warn',
            maxSize: '20m',
            maxFiles: '30d', // Keep security logs longer
            zippedArchive: true,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        })
    ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Security event logger (specialized for security events)
const securityLogger = {
    logAuthAttempt: (ip, success, reason = null) => {
        logger.warn('AUTH_ATTEMPT', {
            event: 'authentication',
            ip,
            success,
            reason,
            timestamp: new Date().toISOString()
        });
    },
    
    logAccessDenied: (ip, reason, endpoint = null) => {
        logger.warn('ACCESS_DENIED', {
            event: 'access_denied',
            ip,
            reason,
            endpoint,
            timestamp: new Date().toISOString()
        });
    },
    
    logRateLimit: (ip, endpoint) => {
        logger.warn('RATE_LIMIT', {
            event: 'rate_limit_exceeded',
            ip,
            endpoint,
            timestamp: new Date().toISOString()
        });
    },
    
    logApiKeyBlocked: (apiKey, reason) => {
        logger.warn('API_KEY_BLOCKED', {
            event: 'api_key_blocked',
            apiKey: apiKey.substring(0, 8) + '...',
            reason,
            timestamp: new Date().toISOString()
        });
    },
    
    logConnectionLimit: (ip, limitType) => {
        logger.warn('CONNECTION_LIMIT', {
            event: 'connection_limit_exceeded',
            ip,
            limitType,
            timestamp: new Date().toISOString()
        });
    },
    
    logSuspiciousActivity: (ip, activity, details = {}) => {
        logger.error('SUSPICIOUS_ACTIVITY', {
            event: 'suspicious_activity',
            ip,
            activity,
            details,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = { logger, securityLogger };

