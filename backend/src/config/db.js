import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/chess_wager',
});

export async function initDb() {
  await pool.query('SELECT NOW()');
  console.log('Database connected');

  // Run migrations
  const migration = readFileSync(
    join(__dirname, '../../migrations/001_create_games.sql'),
    'utf-8'
  );
  await pool.query(migration);
  console.log('Migrations complete');
}
