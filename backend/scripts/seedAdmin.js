import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/chess_wager',
});

async function seed() {
  const password = crypto.randomBytes(8).toString('hex'); // 16-char random password
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (username, email, password_hash, is_admin)
     VALUES ('admin', 'jacobchamie@gmail.com', $1, true)
     ON CONFLICT (email) DO UPDATE SET password_hash = $1, is_admin = true`,
    [hash]
  );

  console.log('Admin account seeded successfully');
  console.log(`Username: admin`);
  console.log(`Password: ${password}`);

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
