# CueSport Stream Backend

Backend server for sharing CueSport Scoreboard game data via WebSocket.

## Features

- WebSocket server for real-time game state updates
- REST API for public stream listing
- Admin dashboard with statistics and API key management
- SQLite database for persistence
- API key authentication
- JWT-based session management for admin access
- Comprehensive logging and monitoring
- Rate limiting (separate limits for different operations)
- IP whitelisting for admin endpoints
- Input sanitization
- Docker support

## Setup

### Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000` by default.

### Docker

1. Build and run with docker-compose:
```bash
docker-compose up -d
```

2. Or build manually:
```bash
docker build -t cuesport-stream-backend .
docker run -p 3000:3000 -v $(pwd)/data:/app/data cuesport-stream-backend
```

## API Endpoints

### Public REST API

- `GET /api/streams` - Get all active streams
- `GET /api/streams/:id` - Get specific stream by ID
- `GET /health` - Health check endpoint

### Admin REST API (Requires Authentication)

- `POST /api/admin/login` - Authenticate and receive JWT tokens
- `POST /api/admin/refresh` - Refresh access token
- `POST /api/admin/logout` - Revoke session
- `GET /api/admin/stats` - Get statistics for all API keys
- `POST /api/admin/block` - Block an API key
- `POST /api/admin/unblock` - Unblock an API key
- `POST /api/admin/clear` - Clear statistics for an API key
- `POST /api/admin/delete` - Delete an API key and all associated data

### WebSocket

- `ws://localhost:3000/ws` - WebSocket endpoint for stream updates

**Authentication Flow:**
1. Connect to WebSocket
2. Send authentication message:
```json
{
  "type": "auth",
  "api_key": "your-api-key-here"
}
```
3. Receive authentication response
4. Send update messages:
```json
{
  "type": "update",
  "api_key": "your-api-key-here",
  "state": {
    "player1Name": "...",
    "player2Name": "...",
    "p1Score": 0,
    "p2Score": 0,
    "gameType": "game1",
    "raceInfo": "...",
    "gameInfo": "...",
    "timestamp": "..."
  }
}
```

## Configuration

Environment variables:
- `PORT` - Server port (default: 3000)
- `DB_PATH` - SQLite database path (default: `./data/streams.db`)
- `NODE_ENV` - Environment (production/development)
- `ADMIN_PASSWORD` - Admin password for accessing statistics dashboard
- `ADMIN_IP_WHITELIST` - Comma-separated list of IPs, CIDR ranges, or domains for admin access (optional)
- `JWT_SECRET` - Secret key for JWT tokens (auto-generated if not set, but should be set in production)
- `JWT_EXPIRY` - Access token expiry in seconds (default: 3600 = 1 hour)
- `JWT_REFRESH_EXPIRY` - Refresh token expiry in seconds (default: 86400 = 24 hours)
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: info)
- `MAX_CONNECTIONS_PER_IP` - Max WebSocket connections per IP (default: 5)
- `MAX_TOTAL_CONNECTIONS` - Max total WebSocket connections (default: 1000)
- `REQUEST_TIMEOUT` - HTTP request timeout in milliseconds (default: 30000)

## Security

### Authentication & Authorization
- API keys must be at least 16 character hex strings
- JWT-based session management for admin access (access tokens + refresh tokens)
- IP binding on tokens to prevent token theft
- IP whitelisting support for admin endpoints (supports IPs, CIDR ranges, and domains)
- Automatic session expiration and refresh

### Rate Limiting
- **REST API**: 100 requests per minute per IP
- **WebSocket Updates**: 60 update messages per minute per API key
- **Admin Login**: 20 attempts per 15 minutes per IP (successful logins don't count)
- **Admin Stats**: 30 requests per minute per IP
- **Admin Actions** (block/unblock/clear/delete): 30 actions per minute per IP
- **Token Refresh**: 10 requests per minute per IP

### Connection Limits
- Maximum 5 WebSocket connections per IP address
- Maximum 1000 total concurrent WebSocket connections
- 10KB maximum message size limit

### Other Security Features
- Input sanitization on all fields
- SQL injection prevention
- Automatic cleanup of inactive streams after 24 hours
- Comprehensive security event logging (authentication attempts, access denials, rate limits, suspicious activity)
- Structured logging with daily rotation
- Security headers (Helmet.js)
- Request size limits (10KB for JSON/URL-encoded)
- Request timeouts (30 seconds default)

## Logging

The application uses Winston for structured logging with daily rotation:

- **Error logs**: `logs/error-YYYY-MM-DD.log` - Errors only
- **Combined logs**: `logs/combined-YYYY-MM-DD.log` - All log levels
- **Security logs**: `logs/security-YYYY-MM-DD.log` - Security events (kept for 30 days)

Logs are automatically rotated daily, compressed, and retained based on configuration (14 days for errors/combined, 30 days for security).

## Admin Dashboard

The admin dashboard is available at `/admin-stats.html` and provides:

- Real-time statistics for all API keys
- Connection history and duration tracking
- Game type and feature usage analytics
- Ability to block/unblock API keys
- Ability to clear or delete API key data
- Search and filtering capabilities
- Auto-refresh every 60 seconds

Access requires:
1. Valid admin password
2. IP address in whitelist (if `ADMIN_IP_WHITELIST` is configured)

