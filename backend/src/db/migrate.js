import { getDb } from './sqlite.js';

/** Apply schema (idempotent — run on startup via npm run migrate) */
getDb();
console.log('Database ready:', process.env.SQLITE_PATH || './data/cuesport.db');
