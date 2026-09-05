'use strict';

/**
 * LEGACY stream-promotion HTTP/WebSocket server — disabled.
 *
 * CueSport Cloud entrypoint is `src/index.js` (`npm start` / Docker CMD).
 * This file is not copied into the Docker image and is not started by package.json.
 *
 * Former companions `auth.js` and `logger.js` were removed: they used CommonJS +
 * undeclared deps (`jsonwebtoken`, `winston`) under package.json `"type": "module"`,
 * and were unused by the cloud stack.
 */
console.error('Legacy server.js is disabled. Start CueSport Cloud with: npm start (src/index.js)');
process.exit(1);
