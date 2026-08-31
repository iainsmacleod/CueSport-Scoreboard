import * as sqlite from '../db/sqlite.js';
import { resolveAccountFromRequest } from './accounts.js';

export async function registerEventRoutes(app) {
  app.get('/api/rooms/:roomId/events', async (request, reply) => {
    const account = await resolveAccountFromRequest(request);
    if (!account) return reply.code(401).send({ error: 'Unauthorized' });
    const { roomId } = request.params;
    if (!sqlite.roomBelongsToAccount(roomId, account.id)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const limit = parseInt(request.query.limit || '100', 10);
    return sqlite.getMatchEvents(roomId, limit);
  });

  app.get('/api/streams', async () => {
    return sqlite.getActiveLiveStreams(30);
  });
}
