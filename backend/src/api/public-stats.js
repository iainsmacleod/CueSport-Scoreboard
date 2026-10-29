import {
  getPublicPlayerStats,
  getPublicLeaderboardByToken,
} from '../stats/public-stats.js';

export async function registerPublicStatsRoutes(app) {
  app.get('/api/public/players/:playerId', async (request, reply) => {
    const playerId = String(request.params.playerId || '').trim();
    if (!playerId) return reply.code(404).send({ error: 'Player not found' });
    const limit = parseInt(request.query.limit || '5000', 10);
    const payload = getPublicPlayerStats(playerId, limit);
    if (!payload) return reply.code(404).send({ error: 'Player not found' });
    return payload;
  });

  app.get('/api/public/leaderboards/:token', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    if (!token) return reply.code(404).send({ error: 'Leaderboard not found' });
    const limit = parseInt(request.query.limit || '5000', 10);
    const payload = getPublicLeaderboardByToken(token, limit);
    if (!payload) return reply.code(404).send({ error: 'Leaderboard not found' });
    return payload;
  });
}
