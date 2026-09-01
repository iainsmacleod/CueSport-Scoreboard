import QRCode from 'qrcode';

const MAX_DATA_LENGTH = 2048;

export function registerQrRoutes(app) {
  /** Self-hosted QR PNG — guest share links never leave your server. */
  app.get('/api/qr', async (request, reply) => {
    const { data, size = '220', margin = '2' } = request.query || {};
    if (!data || typeof data !== 'string') {
      return reply.code(400).send({ error: 'data query parameter required' });
    }
    if (data.length > MAX_DATA_LENGTH) {
      return reply.code(400).send({ error: 'data too long' });
    }

    const width = Math.min(512, Math.max(64, parseInt(size, 10) || 220));
    const marginModules = Math.min(8, Math.max(0, parseInt(margin, 10) || 2));

    try {
      const png = await QRCode.toBuffer(data, {
        type: 'png',
        width,
        margin: marginModules,
        errorCorrectionLevel: 'M',
      });
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.type('image/png').send(png);
    } catch {
      return reply.code(400).send({ error: 'invalid qr data' });
    }
  });
}
