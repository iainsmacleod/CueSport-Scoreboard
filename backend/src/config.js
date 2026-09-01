import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'cuesport.db'),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',
  allowDevAuth: process.env.ALLOW_DEV_AUTH !== 'false',
  devAuthSecret: process.env.DEV_AUTH_SECRET || '',
  devAuthAccountEmail: process.env.DEV_AUTH_ACCOUNT_EMAIL || 'dev@local',
  isSupabase: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
};
