import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { verifyToken } from '../auth/authService.js';

const router = Router();

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = payload;
  next();
}

router.use(authMiddleware);

// --- PKCE helpers ---
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// In-memory store for PKCE state (short-lived, keyed by state param)
const pkceStore = new Map();
const PKCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanPkceStore() {
  const now = Date.now();
  for (const [key, val] of pkceStore) {
    if (now - val.createdAt > PKCE_TTL_MS) pkceStore.delete(key);
  }
}

const LICHESS_CLIENT_ID = process.env.LICHESS_CLIENT_ID || 'chess-wager';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const LICHESS_REDIRECT_URI = `${FRONTEND_URL}/auth/lichess/callback`;

// ===== LICHESS OAUTH =====

// GET /lichess/auth — Start Lichess OAuth flow
router.get('/lichess/auth', (req, res) => {
  cleanPkceStore();
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  pkceStore.set(state, { codeVerifier, userId: req.user.id, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LICHESS_CLIENT_ID,
    redirect_uri: LICHESS_REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  res.json({ url: `https://lichess.org/oauth?${params.toString()}` });
});

// GET /lichess/callback — Exchange code for token, fetch profile + ratings
router.get('/lichess/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    const pkceData = pkceStore.get(state);
    if (!pkceData) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }
    pkceStore.delete(state);

    // Verify the user from the PKCE store matches the authenticated user
    if (pkceData.userId !== req.user.id) {
      return res.status(403).json({ error: 'State mismatch' });
    }

    // Exchange code for token
    const tokenRes = await fetch('https://lichess.org/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LICHESS_REDIRECT_URI,
        client_id: LICHESS_CLIENT_ID,
        code_verifier: pkceData.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Lichess token exchange failed:', errText);
      return res.status(400).json({ error: 'Failed to exchange code with Lichess' });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch account info
    const accountRes = await fetch('https://lichess.org/api/account', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!accountRes.ok) {
      return res.status(400).json({ error: 'Failed to fetch Lichess account' });
    }
    const account = await accountRes.json();
    const lichessUsername = account.username;

    // Extract ratings from account perfs
    const ratings = {};
    const perfs = account.perfs || {};
    for (const tc of ['bullet', 'blitz', 'rapid', 'classical']) {
      if (perfs[tc]?.rating) {
        ratings[tc] = perfs[tc].rating;
      }
    }

    // Revoke the token — we only needed it to verify identity
    await fetch('https://lichess.org/api/token', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});

    // Upsert into linked_accounts
    await pool.query(
      `INSERT INTO linked_accounts (user_id, platform, platform_username, is_verified, ratings, profile_url, ratings_updated_at)
       VALUES ($1, 'lichess', $2, true, $3, $4, NOW())
       ON CONFLICT (user_id, platform) DO UPDATE SET
         platform_username = $2, is_verified = true, ratings = $3,
         profile_url = $4, ratings_updated_at = NOW(), verification_code = NULL`,
      [req.user.id, lichessUsername, JSON.stringify(ratings), `https://lichess.org/@/${lichessUsername}`]
    );

    res.json({
      success: true,
      platform: 'lichess',
      username: lichessUsername,
      ratings,
      profileUrl: `https://lichess.org/@/${lichessUsername}`,
    });
  } catch (err) {
    console.error('Lichess callback error:', err);
    res.status(500).json({ error: 'Lichess linking failed' });
  }
});

// ===== CHESS.COM VERIFICATION =====

// POST /chesscom/start — Start Chess.com verification
router.post('/chesscom/start', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.length < 1 || username.length > 64) {
      return res.status(400).json({ error: 'Valid Chess.com username required' });
    }

    // Verify the username exists on Chess.com
    const checkRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`);
    if (!checkRes.ok) {
      return res.status(400).json({ error: 'Chess.com username not found' });
    }

    const verificationCode = crypto.randomBytes(4).toString('hex'); // 8-char hex

    await pool.query(
      `INSERT INTO linked_accounts (user_id, platform, platform_username, is_verified, verification_code)
       VALUES ($1, 'chess_com', $2, false, $3)
       ON CONFLICT (user_id, platform) DO UPDATE SET
         platform_username = $2, is_verified = false, verification_code = $3`,
      [req.user.id, username, verificationCode]
    );

    res.json({
      verificationCode,
      instructions: `Add the code "${verificationCode}" to your Chess.com profile Location field, then click Verify.`,
    });
  } catch (err) {
    console.error('Chess.com start error:', err);
    res.status(500).json({ error: 'Failed to start verification' });
  }
});

// POST /chesscom/verify — Verify Chess.com profile text
router.post('/chesscom/verify', async (req, res) => {
  try {
    // Get the pending linked account
    const acctResult = await pool.query(
      `SELECT platform_username, verification_code FROM linked_accounts
       WHERE user_id = $1 AND platform = 'chess_com' AND is_verified = false`,
      [req.user.id]
    );
    const acct = acctResult.rows[0];
    if (!acct) {
      return res.status(400).json({ error: 'No pending Chess.com verification found' });
    }

    // Fetch profile from Chess.com API
    const profileRes = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(acct.platform_username.toLowerCase())}`
    );
    if (!profileRes.ok) {
      return res.status(400).json({ error: 'Could not fetch Chess.com profile' });
    }
    const profile = await profileRes.json();

    // Check if location contains the verification code
    const location = profile.location || '';
    if (!location.includes(acct.verification_code)) {
      return res.status(400).json({
        error: `Verification code not found in your Chess.com Location field. Make sure "${acct.verification_code}" is in your Location.`,
      });
    }

    // Fetch ratings
    const ratings = {};
    try {
      const statsRes = await fetch(
        `https://api.chess.com/pub/player/${encodeURIComponent(acct.platform_username.toLowerCase())}/stats`
      );
      if (statsRes.ok) {
        const stats = await statsRes.json();
        for (const [key, label] of [['chess_bullet', 'bullet'], ['chess_blitz', 'blitz'], ['chess_rapid', 'rapid']]) {
          if (stats[key]?.last?.rating) {
            ratings[label] = stats[key].last.rating;
          }
        }
      }
    } catch (e) {
      console.error('Chess.com stats fetch error:', e.message);
    }

    const profileUrl = `https://www.chess.com/member/${acct.platform_username}`;

    await pool.query(
      `UPDATE linked_accounts SET is_verified = true, ratings = $1, profile_url = $2,
       ratings_updated_at = NOW(), verification_code = NULL
       WHERE user_id = $3 AND platform = 'chess_com'`,
      [JSON.stringify(ratings), profileUrl, req.user.id]
    );

    res.json({
      success: true,
      platform: 'chess_com',
      username: acct.platform_username,
      ratings,
      profileUrl,
    });
  } catch (err) {
    console.error('Chess.com verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ===== COMMON ENDPOINTS =====

// GET /accounts — Get user's linked accounts
router.get('/accounts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT platform, platform_username, is_verified, verification_code, ratings, profile_url, ratings_updated_at
       FROM linked_accounts WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ accounts: result.rows });
  } catch (err) {
    console.error('Linked accounts fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch linked accounts' });
  }
});

// DELETE /accounts/:platform — Unlink an account
router.delete('/accounts/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    if (!['chess_com', 'lichess'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    await pool.query(
      'DELETE FROM linked_accounts WHERE user_id = $1 AND platform = $2',
      [req.user.id, platform]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Unlink error:', err);
    res.status(500).json({ error: 'Failed to unlink account' });
  }
});

// POST /accounts/:platform/refresh — Refresh ratings from platform
router.post('/accounts/:platform/refresh', async (req, res) => {
  try {
    const { platform } = req.params;
    if (!['chess_com', 'lichess'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const acctResult = await pool.query(
      'SELECT platform_username FROM linked_accounts WHERE user_id = $1 AND platform = $2 AND is_verified = true',
      [req.user.id, platform]
    );
    const acct = acctResult.rows[0];
    if (!acct) {
      return res.status(404).json({ error: 'No verified account found for this platform' });
    }

    const ratings = {};

    if (platform === 'lichess') {
      const userRes = await fetch(`https://lichess.org/api/user/${encodeURIComponent(acct.platform_username)}`);
      if (!userRes.ok) {
        return res.status(400).json({ error: 'Failed to fetch Lichess profile' });
      }
      const userData = await userRes.json();
      const perfs = userData.perfs || {};
      for (const tc of ['bullet', 'blitz', 'rapid', 'classical']) {
        if (perfs[tc]?.rating) ratings[tc] = perfs[tc].rating;
      }
    } else {
      const statsRes = await fetch(
        `https://api.chess.com/pub/player/${encodeURIComponent(acct.platform_username.toLowerCase())}/stats`
      );
      if (!statsRes.ok) {
        return res.status(400).json({ error: 'Failed to fetch Chess.com stats' });
      }
      const stats = await statsRes.json();
      for (const [key, label] of [['chess_bullet', 'bullet'], ['chess_blitz', 'blitz'], ['chess_rapid', 'rapid']]) {
        if (stats[key]?.last?.rating) ratings[label] = stats[key].last.rating;
      }
    }

    await pool.query(
      'UPDATE linked_accounts SET ratings = $1, ratings_updated_at = NOW() WHERE user_id = $2 AND platform = $3',
      [JSON.stringify(ratings), req.user.id, platform]
    );

    res.json({ ratings });
  } catch (err) {
    console.error('Refresh ratings error:', err);
    res.status(500).json({ error: 'Failed to refresh ratings' });
  }
});

export default router;
