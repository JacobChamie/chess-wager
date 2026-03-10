import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'http';

// Mock pool and verifyToken before importing the router
vi.mock('../../src/config/db.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('../../src/auth/authService.js', () => ({
  verifyToken: vi.fn(),
}));

import { pool } from '../../src/config/db.js';
import { verifyToken } from '../../src/auth/authService.js';
import linkedAccountRoutes from '../../src/linkedAccounts/linkedAccountRoutes.js';

// Save original fetch before any tests can mock it
const realFetch = global.fetch;

let server, baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/linked', linkedAccountRoutes);
  const httpServer = createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  baseUrl = `http://localhost:${port}/api/linked`;
  server = httpServer;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: auth succeeds
  verifyToken.mockReturnValue({ id: 'user-1', username: 'alice' });
});

afterEach(() => {
  global.fetch = realFetch;
});

function authHeaders() {
  return { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' };
}

/** Use realFetch for test requests to localhost, mock for external APIs */
function mockExternalFetch(handler) {
  global.fetch = vi.fn().mockImplementation((url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.startsWith('http://localhost')) {
      return realFetch(url, opts);
    }
    return handler(urlStr, opts);
  });
}

/** Make a test request using realFetch (bypasses any global.fetch mock) */
function testFetch(url, opts) {
  return realFetch(url, opts);
}

describe('Linked Accounts Routes', () => {
  // --- Auth middleware ---
  describe('authMiddleware', () => {
    it('rejects requests without token', async () => {
      const res = await testFetch(`${baseUrl}/accounts`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('No token provided');
    });

    it('rejects requests with invalid token', async () => {
      verifyToken.mockReturnValue(null);
      const res = await testFetch(`${baseUrl}/accounts`, { headers: authHeaders() });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid token');
    });
  });

  // --- GET /accounts ---
  describe('GET /accounts', () => {
    it('returns linked accounts for user', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            platform: 'lichess',
            platform_username: 'alice_lichess',
            is_verified: true,
            verification_code: null,
            ratings: { blitz: 1500 },
            profile_url: 'https://lichess.org/@/alice_lichess',
            ratings_updated_at: new Date().toISOString(),
          },
        ],
      });

      const res = await testFetch(`${baseUrl}/accounts`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.accounts).toHaveLength(1);
      expect(data.accounts[0].platform).toBe('lichess');
      expect(data.accounts[0].platform_username).toBe('alice_lichess');
    });

    it('returns empty array when no accounts linked', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await testFetch(`${baseUrl}/accounts`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.accounts).toHaveLength(0);
    });
  });

  // --- DELETE /accounts/:platform ---
  describe('DELETE /accounts/:platform', () => {
    it('unlinks a valid platform', async () => {
      pool.query.mockResolvedValueOnce({});

      const res = await testFetch(`${baseUrl}/accounts/lichess`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM linked_accounts WHERE user_id = $1 AND platform = $2',
        ['user-1', 'lichess']
      );
    });

    it('rejects invalid platform', async () => {
      const res = await testFetch(`${baseUrl}/accounts/facebook`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid platform');
    });
  });

  // --- POST /chesscom/start ---
  describe('POST /chesscom/start', () => {
    it('starts verification with valid Chess.com username', async () => {
      mockExternalFetch((url) => {
        if (url.includes('api.chess.com/pub/player/')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'testuser' }) });
        }
        return realFetch(url);
      });
      pool.query.mockResolvedValueOnce({});

      const res = await testFetch(`${baseUrl}/chesscom/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ username: 'testuser' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.verificationCode).toBeDefined();
      expect(data.verificationCode).toHaveLength(8);
      expect(data.instructions).toContain(data.verificationCode);
    });

    it('rejects missing username', async () => {
      const res = await testFetch(`${baseUrl}/chesscom/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('rejects nonexistent Chess.com user', async () => {
      mockExternalFetch((url) => {
        if (url.includes('api.chess.com/pub/player/')) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return realFetch(url);
      });

      const res = await testFetch(`${baseUrl}/chesscom/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ username: 'nonexistent_user_xyz' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Chess.com username not found');
    });
  });

  // --- POST /chesscom/verify ---
  describe('POST /chesscom/verify', () => {
    it('verifies when code is found in location field', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ platform_username: 'testuser', verification_code: 'abc12345' }],
        })
        .mockResolvedValueOnce({});

      mockExternalFetch((url) => {
        if (url.includes('api.chess.com/pub/player/testuser/stats')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              chess_blitz: { last: { rating: 1500 } },
              chess_rapid: { last: { rating: 1600 } },
              chess_bullet: { last: { rating: 1400 } },
            }),
          });
        }
        if (url.includes('api.chess.com/pub/player/testuser')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ location: 'New York abc12345' }),
          });
        }
        return realFetch(url);
      });

      const res = await testFetch(`${baseUrl}/chesscom/verify`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.platform).toBe('chess_com');
      expect(data.username).toBe('testuser');
      expect(data.ratings.blitz).toBe(1500);
      expect(data.ratings.rapid).toBe(1600);
      expect(data.ratings.bullet).toBe(1400);
      expect(data.profileUrl).toBe('https://www.chess.com/member/testuser');
    });

    it('fails when code not found in location', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ platform_username: 'testuser', verification_code: 'abc12345' }],
      });

      mockExternalFetch((url) => {
        if (url.includes('api.chess.com/pub/player/testuser')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ location: 'New York' }),
          });
        }
        return realFetch(url);
      });

      const res = await testFetch(`${baseUrl}/chesscom/verify`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Verification code not found');
    });

    it('fails when no pending verification exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await testFetch(`${baseUrl}/chesscom/verify`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('No pending Chess.com verification found');
    });
  });

  // --- POST /accounts/:platform/refresh ---
  describe('POST /accounts/:platform/refresh', () => {
    it('refreshes Lichess ratings', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ platform_username: 'alice_lichess' }] })
        .mockResolvedValueOnce({});

      mockExternalFetch((url) => {
        if (url.includes('lichess.org/api/user/')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              perfs: {
                blitz: { rating: 1800 },
                rapid: { rating: 1900 },
                bullet: { rating: 1700 },
              },
            }),
          });
        }
        return realFetch(url);
      });

      const res = await testFetch(`${baseUrl}/accounts/lichess/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ratings.blitz).toBe(1800);
      expect(data.ratings.rapid).toBe(1900);
      expect(data.ratings.bullet).toBe(1700);
    });

    it('refreshes Chess.com ratings', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ platform_username: 'alice_chess' }] })
        .mockResolvedValueOnce({});

      mockExternalFetch((url) => {
        if (url.includes('api.chess.com/pub/player/alice_chess/stats')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              chess_blitz: { last: { rating: 1500 } },
              chess_rapid: { last: { rating: 1600 } },
            }),
          });
        }
        return realFetch(url);
      });

      const res = await testFetch(`${baseUrl}/accounts/chess_com/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ratings.blitz).toBe(1500);
      expect(data.ratings.rapid).toBe(1600);
    });

    it('returns 404 when no verified account exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await testFetch(`${baseUrl}/accounts/lichess/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });

    it('rejects invalid platform', async () => {
      const res = await testFetch(`${baseUrl}/accounts/twitter/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
    });
  });

  // --- GET /lichess/auth ---
  describe('GET /lichess/auth', () => {
    it('returns Lichess OAuth URL with PKCE params', async () => {
      const res = await testFetch(`${baseUrl}/lichess/auth`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toContain('https://lichess.org/oauth');
      expect(data.url).toContain('response_type=code');
      expect(data.url).toContain('code_challenge=');
      expect(data.url).toContain('code_challenge_method=S256');
      expect(data.url).toContain('state=');
    });
  });

  // --- GET /lichess/callback ---
  describe('GET /lichess/callback', () => {
    it('returns 400 when code or state is missing', async () => {
      const res = await testFetch(`${baseUrl}/lichess/callback`, { headers: authHeaders() });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Missing code or state');
    });

    it('returns 400 for invalid state', async () => {
      const res = await testFetch(`${baseUrl}/lichess/callback?code=test&state=invalid`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid or expired state');
    });

    it('completes full Lichess OAuth flow', async () => {
      // First, get the auth URL to populate the PKCE store
      const authRes = await testFetch(`${baseUrl}/lichess/auth`, { headers: authHeaders() });
      const authData = await authRes.json();
      const authUrl = new URL(authData.url);
      const state = authUrl.searchParams.get('state');

      // Mock the Lichess API calls (but let localhost through)
      mockExternalFetch((url) => {
        if (url === 'https://lichess.org/api/token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ access_token: 'lichess-token-123' }),
            text: () => Promise.resolve(''),
          });
        }
        if (url === 'https://lichess.org/api/account') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              username: 'AliceLichess',
              perfs: {
                blitz: { rating: 1800 },
                rapid: { rating: 1900 },
              },
            }),
          });
        }
        return realFetch(url);
      });

      pool.query.mockResolvedValueOnce({});

      const callbackRes = await testFetch(
        `${baseUrl}/lichess/callback?code=test-code&state=${state}`,
        { headers: authHeaders() }
      );
      expect(callbackRes.status).toBe(200);
      const data = await callbackRes.json();
      expect(data.success).toBe(true);
      expect(data.platform).toBe('lichess');
      expect(data.username).toBe('AliceLichess');
      expect(data.ratings.blitz).toBe(1800);
      expect(data.ratings.rapid).toBe(1900);
      expect(data.profileUrl).toBe('https://lichess.org/@/AliceLichess');
    });
  });
});
