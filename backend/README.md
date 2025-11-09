# CueSport Stream Backend

Backend server for sharing CueSport Scoreboard game data via WebSocket.

## Features

- WebSocket server for real-time game state updates
- REST API for public stream listing
- SQLite database for persistence
- API key authentication
- Rate limiting
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

### REST API

- `GET /api/streams` - Get all active streams
- `GET /api/streams/:id` - Get specific stream by ID
- `GET /health` - Health check

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

## Security

- API keys must be at least 16 character hex strings
- Rate limiting: 60 requests per minute per API key
- Input sanitization on all fields
- Automatic cleanup of inactive streams after 24 hours

