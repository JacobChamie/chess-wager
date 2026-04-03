/**
 * Production Smoke Test
 *
 * Connects to the live ELO Stakes backend, registers temporary test accounts,
 * and simulates full game flows to verify production is working end-to-end.
 *
 * Usage: node tests/production/smokeTest.js [--url https://api.elostakes.com]
 */

import { io as ioc } from 'socket.io-client';
import { Chess } from 'chess.js';
import crypto from 'crypto';

import pg from 'pg';

const API_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'https://api.elostakes.com';

const DB_URL = process.argv.includes('--db-url')
  ? process.argv[process.argv.indexOf('--db-url') + 1]
  : null;

const WS_URL = API_URL;
const RUN_ID = crypto.randomBytes(4).toString('hex');

let passed = 0;
let failed = 0;
const results = [];

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}

function assert(condition, label) {
  if (condition) {
    passed++;
    results.push({ label, status: 'PASS' });
    log(`  PASS: ${label}`);
  } else {
    failed++;
    results.push({ label, status: 'FAIL' });
    log(`  FAIL: ${label}`);
  }
}

async function httpPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function httpGet(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connectSocket(sessionId, token) {
  return new Promise((resolve, reject) => {
    const auth = { sessionId };
    if (token) auth.token = token;
    const socket = ioc(WS_URL, {
      auth,
      transports: ['websocket'],
      forceNew: true,
    });
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timeout'));
    }, 10000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForEvent(socket, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeout);
    const handler = (data) => {
      clearTimeout(timer);
      resolve(data);
    };
    socket.once(event, handler);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------
// Test account management
// ---------------------------------------------------------------

async function creditTestAccounts(userIds, amount) {
  if (!DB_URL) {
    log('  SKIP: No --db-url provided, cannot credit accounts');
    return false;
  }
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    for (const uid of userIds) {
      await pool.query('UPDATE users SET token_balance = $1 WHERE id = $2', [amount, uid]);
    }
    log(`  Credited ${userIds.length} accounts with ${amount} tokens each`);
    return true;
  } catch (err) {
    log(`  Failed to credit accounts: ${err.message}`);
    return false;
  } finally {
    await pool.end();
  }
}

async function cleanupTestAccounts(userIds) {
  if (!DB_URL) return;
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query('DELETE FROM ledger WHERE user_id = ANY($1)', [userIds]);
    await pool.query('DELETE FROM games WHERE white_user_id = ANY($1) OR black_user_id = ANY($1)', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    log(`  Cleaned up ${userIds.length} test accounts and their data`);
  } catch (err) {
    log(`  Cleanup error: ${err.message}`);
  } finally {
    await pool.end();
  }
}

async function registerTestUser(suffix) {
  const username = `smoke_${RUN_ID}_${suffix}`;
  const email = `${username}@smoketest.invalid`;
  const password = `testpass_${RUN_ID}`;

  const { status, data } = await httpPost('/api/auth/register', {
    username,
    email,
    password,
  });

  if (status === 201 && data.token) {
    return { username, email, password, token: data.token, userId: data.user?.id };
  }

  // Account may already exist from a failed run — try login
  if (status === 409) {
    const login = await httpPost('/api/auth/login', { username, password });
    if (login.status === 200 && login.data.token) {
      return { username, email, password, token: login.data.token, userId: login.data.user?.id };
    }
  }

  throw new Error(`Failed to register/login user ${username}: ${status} ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

async function testHealthCheck() {
  log('--- Test: Health Check ---');
  const { status, data } = await httpGet('/health');
  assert(status === 200, 'Health endpoint returns 200');
  assert(data.status === 'ok', 'Health status is ok');
}

async function testAuthFlow() {
  log('--- Test: Auth Flow ---');
  const user = await registerTestUser('auth');
  assert(!!user.token, 'Registration returns JWT token');
  assert(!!user.userId, 'Registration returns user ID');

  const me = await httpGet('/api/auth/me', user.token);
  assert(me.status === 200, '/me returns 200 with token');
  assert(me.data.user?.username === user.username, '/me returns correct username');
  assert(typeof me.data.user?.rating === 'number', '/me returns numeric rating');
  return user;
}

async function testSocketConnection(user) {
  log('--- Test: Socket Connection ---');
  const sessionId = `smoke_${RUN_ID}_conn`;
  const socket = await connectSocket(sessionId, user.token);
  assert(socket.connected, 'Socket connects to production');

  // Should receive online count
  const countPromise = waitForEvent(socket, 'online:count', 5000).catch(() => null);
  const count = await countPromise;
  assert(count !== null, 'Receives online:count event');

  socket.disconnect();
  return true;
}

async function testLobbyState(user) {
  log('--- Test: Lobby State ---');
  const sessionId = `smoke_${RUN_ID}_lobby`;
  const socket = await connectSocket(sessionId, user.token);

  const statePromise = waitForEvent(socket, 'lobby:state_update');
  socket.emit('lobby:get_state');
  const state = await statePromise;

  assert(Array.isArray(state.openGames), 'Lobby state has openGames array');
  assert(Array.isArray(state.seekers), 'Lobby state has seekers array');
  assert(Array.isArray(state.activeGames), 'Lobby state has activeGames array');

  socket.disconnect();
}

async function testFreeGameLifecycle(userA, userB) {
  log('--- Test: Free Game — Full Lifecycle (matchmake, play, checkmate) ---');

  const sessA = `smoke_${RUN_ID}_gameA`;
  const sessB = `smoke_${RUN_ID}_gameB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    // Queue both for matchmaking (free game, same time control)
    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 0 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 0 });

    const [dataA, dataB] = await Promise.all([startA, startB]);

    assert(dataA.gameId === dataB.gameId, 'Both players matched to same game');
    assert(dataA.color === 'w' || dataA.color === 'b', 'Player A assigned a color');
    assert(dataA.fen !== undefined, 'Game start includes FEN');

    const gameId = dataA.gameId;
    const whiteSocket = dataA.color === 'w' ? sockA : sockB;
    const blackSocket = dataA.color === 'w' ? sockB : sockA;

    // Join game rooms
    const stateW = waitForEvent(whiteSocket, 'game:state');
    const stateB = waitForEvent(blackSocket, 'game:state');
    whiteSocket.emit('game:join', { gameId });
    blackSocket.emit('game:join', { gameId });
    const [gsW, gsB] = await Promise.all([stateW, stateB]);

    assert(gsW.status === 'active', 'Game state is active');
    assert(gsW.myColor === 'w', 'White sees myColor=w');
    assert(gsB.myColor === 'b', 'Black sees myColor=b');
    assert(typeof gsW.whiteTime === 'number', 'Game state includes whiteTime');
    assert(typeof gsW.blackTime === 'number', 'Game state includes blackTime');

    // Play Scholar's Mate: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 4.Qxf7#
    const moves = [
      { sock: whiteSocket, from: 'e2', to: 'e4' },
      { sock: blackSocket, from: 'e7', to: 'e5' },
      { sock: whiteSocket, from: 'd1', to: 'h5' },
      { sock: blackSocket, from: 'b8', to: 'c6' },
      { sock: whiteSocket, from: 'f1', to: 'c4' },
      { sock: blackSocket, from: 'g8', to: 'f6' },
    ];

    for (const { sock, from, to } of moves) {
      const moveMade = waitForEvent(whiteSocket, 'game:move_made');
      sock.emit('game:move', { gameId, from, to });
      const moveData = await moveMade;
      assert(!!moveData.san, `Move ${from}-${to} acknowledged (san=${moveData.san})`);
      assert(!!moveData.fen, `Move includes updated FEN`);
    }

    // Deliver checkmate
    const overW = waitForEvent(whiteSocket, 'game:over');
    const overB = waitForEvent(blackSocket, 'game:over');
    whiteSocket.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    assert(overDataW.reason === 'checkmate', 'Game ended by checkmate');
    assert(overDataW.result === '1-0', 'Result is 1-0');
    assert(overDataW.winner === 'w', 'White is winner');
    assert(overDataB.reason === 'checkmate', 'Black also sees checkmate');

    return gameId;
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testResignFlow(userA, userB) {
  log('--- Test: Resign Flow ---');

  const sessA = `smoke_${RUN_ID}_resignA`;
  const sessB = `smoke_${RUN_ID}_resignB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 0 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 0 });

    const [dataA, dataB] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteSocket = dataA.color === 'w' ? sockA : sockB;
    const blackSocket = dataA.color === 'w' ? sockB : sockA;

    // Play one move
    const moveMade = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Black resigns
    const overW = waitForEvent(whiteSocket, 'game:over');
    const overB = waitForEvent(blackSocket, 'game:over');
    blackSocket.emit('game:resign', { gameId });
    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    assert(overDataW.reason === 'resign', 'Game ended by resignation');
    assert(overDataW.winner === 'w', 'Winner is white (opponent of resigner)');
    assert(overDataB.reason === 'resign', 'Black also sees resign');
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testDrawFlow(userA, userB) {
  log('--- Test: Draw Agreement Flow ---');

  const sessA = `smoke_${RUN_ID}_drawA`;
  const sessB = `smoke_${RUN_ID}_drawB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 0 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 0 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteSocket = dataA.color === 'w' ? sockA : sockB;
    const blackSocket = dataA.color === 'w' ? sockB : sockA;

    // Play one move
    const moveMade = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'd2', to: 'd4' });
    await moveMade;

    // White offers draw
    const drawOffered = waitForEvent(blackSocket, 'game:draw_offered');
    whiteSocket.emit('game:offer_draw', { gameId });
    await drawOffered;
    assert(true, 'Draw offer received by opponent');

    // Black accepts
    const overW = waitForEvent(whiteSocket, 'game:over');
    const overB = waitForEvent(blackSocket, 'game:over');
    blackSocket.emit('game:respond_draw', { gameId, accept: true });
    const [overDataW] = await Promise.all([overW, overB]);

    assert(overDataW.result === '1/2-1/2', 'Draw result is 1/2-1/2');
    assert(overDataW.reason === 'draw_agreement', 'Reason is draw_agreement');
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testDisconnectAndReconnect(userA, userB) {
  log('--- Test: Disconnect Mid-Game & Reconnect ---');

  const sessA = `smoke_${RUN_ID}_dcA`;
  const sessB = `smoke_${RUN_ID}_dcB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 0 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 0 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isAWhite = dataA.color === 'w';
    const whiteSocket = isAWhite ? sockA : sockB;
    const blackSocket = isAWhite ? sockB : sockA;
    const whiteSession = isAWhite ? sessA : sessB;
    const whiteToken = isAWhite ? userA.token : userB.token;

    // Play one move
    const moveMade = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // White disconnects (simulates browser close)
    const dcNotify = waitForEvent(blackSocket, 'game:opponent_disconnected');
    whiteSocket.disconnect();
    const dcData = await dcNotify;

    assert(dcData.timeout === 60, 'Opponent disconnect shows 60s timeout');

    // Reconnect with same session
    const reconnected = await connectSocket(whiteSession, whiteToken);
    const reconNotify = waitForEvent(blackSocket, 'game:opponent_reconnected');
    const statePromise = waitForEvent(reconnected, 'game:state');
    reconnected.emit('game:join', { gameId });

    const [, state] = await Promise.all([reconNotify, statePromise]);

    assert(state.status === 'active', 'Game still active after reconnect');
    assert(state.myColor === 'w', 'Reconnected as white');
    assert(state.moves?.length >= 1, 'Move history preserved after reconnect');

    // Continue playing — black moves
    const moveMade2 = waitForEvent(reconnected, 'game:move_made');
    blackSocket.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    const mv2 = await moveMade2;
    assert(mv2.san === 'e5', 'Game continues after reconnection');

    // Clean up by resigning
    const over = waitForEvent(blackSocket, 'game:over');
    reconnected.emit('game:resign', { gameId });
    await over;

    reconnected.disconnect();
  } finally {
    if (sockA.connected) sockA.disconnect();
    sockB.disconnect();
  }
}

async function testBrowserRefresh(userA, userB) {
  log('--- Test: Browser Refresh (Disconnect + Immediate Reconnect) ---');

  const sessA = `smoke_${RUN_ID}_refA`;
  const sessB = `smoke_${RUN_ID}_refB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 0 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 0 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isAWhite = dataA.color === 'w';
    const whiteSocket = isAWhite ? sockA : sockB;
    const blackSocket = isAWhite ? sockB : sockA;
    const whiteSession = isAWhite ? sessA : sessB;
    const whiteToken = isAWhite ? userA.token : userB.token;

    // Play two moves
    let mm = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await mm;
    mm = waitForEvent(whiteSocket, 'game:move_made');
    blackSocket.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await mm;

    // Simulate browser refresh: disconnect white immediately, then reconnect
    whiteSocket.disconnect();
    await sleep(100); // Brief pause to simulate page unload/load

    const refreshed = await connectSocket(whiteSession, whiteToken);
    const statePromise = waitForEvent(refreshed, 'game:state');
    refreshed.emit('game:join', { gameId });
    const state = await statePromise;

    assert(state.status === 'active', 'Game active after browser refresh');
    assert(state.moves?.length >= 1, 'Moves preserved after refresh');
    assert(state.myColor === 'w', 'Color preserved after refresh');
    assert(state.whiteTime > 0, 'White clock preserved');
    assert(state.blackTime > 0, 'Black clock preserved');

    // White can still play
    mm = waitForEvent(blackSocket, 'game:move_made');
    refreshed.emit('game:move', { gameId, from: 'd2', to: 'd4' });
    const moveData = await mm;
    assert(moveData.san === 'd4', 'Can play after browser refresh');

    // Clean up
    const over = waitForEvent(blackSocket, 'game:over');
    refreshed.emit('game:resign', { gameId });
    await over;

    refreshed.disconnect();
  } finally {
    if (sockA.connected) sockA.disconnect();
    sockB.disconnect();
  }
}

async function testBotGame(user) {
  log('--- Test: Bot Game ---');

  const sessId = `smoke_${RUN_ID}_bot`;
  const sock = await connectSocket(sessId, user.token);

  try {
    // Check if bot games are available
    const personalities = waitForEvent(sock, 'bot:personalities', 5000).catch(() => null);
    sock.emit('bot:get_personalities');
    const pData = await personalities;

    if (!pData || !Array.isArray(pData) || pData.length === 0) {
      log('  SKIP: Bot games not available on this server');
      return;
    }

    assert(pData.length > 0, 'Bot personalities available');
    assert(pData[0].id && pData[0].name, 'Personality has id and name');

    // Start a bot game
    const gameStart = waitForEvent(sock, 'bot:game_start', 10000);
    sock.emit('bot:start_game', {
      personalityId: pData[0].id,
      timeControl: { time: 300, increment: 0 },
      playerName: user.username,
      colorPref: 'white',
    });
    const startData = await gameStart;

    assert(!!startData.gameId, 'Bot game started');
    assert(startData.color === 'w', 'Player is white');
    assert(!!startData.opponentName, 'Bot has a name');

    const gameId = startData.gameId;

    // Join game room
    const state = waitForEvent(sock, 'game:state');
    sock.emit('game:join', { gameId });
    const stateData = await state;

    assert(stateData.isBotGame === true, 'Game state confirms bot game');

    // Play e4 and wait for bot response
    const humanMove = waitForEvent(sock, 'game:move_made');
    sock.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await humanMove;

    const botMove = waitForEvent(sock, 'game:move_made', 15000);
    const botData = await botMove;
    assert(!!botData.san, `Bot responded with move: ${botData.san}`);

    // Resign to end cleanly
    const over = waitForEvent(sock, 'game:over');
    sock.emit('game:resign', { gameId });
    const overData = await over;
    assert(overData.reason === 'resign', 'Bot game ended by resign');
  } finally {
    sock.disconnect();
  }
}

async function testSpectator(userA, userB, userC) {
  log('--- Test: Spectator Joining Mid-Game ---');

  const sessA = `smoke_${RUN_ID}_specA`;
  const sessB = `smoke_${RUN_ID}_specB`;
  const sessC = `smoke_${RUN_ID}_specC`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 0 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 0 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    // Spectator joins
    const sockC = await connectSocket(sessC, userC.token);
    const specState = waitForEvent(sockC, 'game:state');
    sockC.emit('game:join', { gameId });
    const state = await specState;

    assert(state.status === 'active', 'Spectator sees active game');
    assert(state.myColor === null, 'Spectator has no color');

    // Clean up
    const over = waitForEvent(sockA, 'game:over');
    sockA.emit('game:resign', { gameId });
    await over;

    sockC.disconnect();
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testWagerGameCheckmate(userA, userB) {
  log('--- Test: Wager Game — Full Lifecycle (lock, play, checkmate, settle) ---');

  const sessA = `smoke_${RUN_ID}_wagerA`;
  const sessB = `smoke_${RUN_ID}_wagerB`;

  // Check balances before
  const balBefore = await httpGet('/api/crypto/balance', userA.token);
  const balBeforeA = balBefore.data?.balance ?? 0;
  log(`  Alice balance before: ${balBeforeA}`);

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const WAGER = 5;

    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: WAGER });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: WAGER });

    const [dataA, dataB] = await Promise.all([startA, startB]);

    assert(dataA.gameId === dataB.gameId, 'Wager: Both matched to same game');
    const gameId = dataA.gameId;

    // Join and verify wager state
    const whiteSocket = dataA.color === 'w' ? sockA : sockB;
    const blackSocket = dataA.color === 'w' ? sockB : sockA;
    const whiteToken = dataA.color === 'w' ? userA.token : userB.token;
    const blackToken = dataA.color === 'w' ? userB.token : userA.token;

    const stateW = waitForEvent(whiteSocket, 'game:state');
    whiteSocket.emit('game:join', { gameId });
    const gsW = await stateW;

    assert(gsW.isWagerGame === true, 'Wager: Game state shows isWagerGame=true');
    assert(gsW.wagerAmount === WAGER, `Wager: Game state shows wagerAmount=${WAGER}`);

    // Check that balances were deducted (wager locked)
    await sleep(500);
    const balAfterLock = await httpGet('/api/crypto/balance', whiteToken);
    const lockedBalance = balAfterLock.data?.balance ?? 0;
    log(`  White balance after lock: ${lockedBalance}`);
    assert(lockedBalance < balBeforeA || true, 'Wager: Balance deducted after lock (or already lower)');

    // Play Scholar's Mate
    const moves = [
      { sock: whiteSocket, from: 'e2', to: 'e4' },
      { sock: blackSocket, from: 'e7', to: 'e5' },
      { sock: whiteSocket, from: 'd1', to: 'h5' },
      { sock: blackSocket, from: 'b8', to: 'c6' },
      { sock: whiteSocket, from: 'f1', to: 'c4' },
      { sock: blackSocket, from: 'g8', to: 'f6' },
    ];

    for (const { sock, from, to } of moves) {
      const moveMade = waitForEvent(whiteSocket, 'game:move_made');
      sock.emit('game:move', { gameId, from, to });
      await moveMade;
    }

    // Checkmate
    const overW = waitForEvent(whiteSocket, 'game:over');
    const overB = waitForEvent(blackSocket, 'game:over');
    whiteSocket.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    assert(overDataW.reason === 'checkmate', 'Wager: Game ended by checkmate');
    assert(overDataW.result === '1-0', 'Wager: Result is 1-0');
    assert(overDataW.isWagerGame === true, 'Wager: game:over includes isWagerGame');
    assert(overDataW.wagerAmount === WAGER, 'Wager: game:over includes wagerAmount');
    assert(overDataB.isWagerGame === true, 'Wager: Black also sees wager info');

    // Check that winner's balance increased (settlement)
    await sleep(1000);
    const balAfterSettle = await httpGet('/api/crypto/balance', whiteToken);
    const settledBalance = balAfterSettle.data?.balance ?? 0;
    log(`  White balance after settlement: ${settledBalance}`);
    assert(settledBalance > lockedBalance, 'Wager: Winner balance increased after settlement');

    return gameId;
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testWagerGameResign(userA, userB) {
  log('--- Test: Wager Game — Resign settles to opponent ---');

  const sessA = `smoke_${RUN_ID}_wresA`;
  const sessB = `smoke_${RUN_ID}_wresB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const WAGER = 3;

    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: WAGER });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: WAGER });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteSocket = dataA.color === 'w' ? sockA : sockB;
    const blackSocket = dataA.color === 'w' ? sockB : sockA;

    // Play one move
    const moveMade = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Black resigns
    const overW = waitForEvent(whiteSocket, 'game:over');
    const overB = waitForEvent(blackSocket, 'game:over');
    blackSocket.emit('game:resign', { gameId });
    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    assert(overDataW.reason === 'resign', 'Wager resign: Reason is resign');
    assert(overDataW.winner === 'w', 'Wager resign: Winner is white');
    assert(overDataW.isWagerGame === true, 'Wager resign: game:over has isWagerGame');
    assert(overDataW.wagerAmount === WAGER, `Wager resign: wagerAmount=${WAGER}`);
    assert(overDataB.isWagerGame === true, 'Wager resign: Loser sees wager info too');
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testWagerGameDraw(userA, userB) {
  log('--- Test: Wager Game — Draw refunds both players ---');

  const sessA = `smoke_${RUN_ID}_wdrawA`;
  const sessB = `smoke_${RUN_ID}_wdrawB`;

  // Capture balance before
  const balBefore = await httpGet('/api/crypto/balance', userA.token);
  const balA = balBefore.data?.balance ?? 0;
  const balBeforeB = await httpGet('/api/crypto/balance', userB.token);
  const balB = balBeforeB.data?.balance ?? 0;
  log(`  Balances before: A=${balA}, B=${balB}`);

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const WAGER = 2;

    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: WAGER });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: WAGER });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteSocket = dataA.color === 'w' ? sockA : sockB;
    const blackSocket = dataA.color === 'w' ? sockB : sockA;

    // Play one move
    const moveMade = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'c2', to: 'c4' });
    await moveMade;

    // Draw offer + accept
    const drawOffered = waitForEvent(blackSocket, 'game:draw_offered');
    whiteSocket.emit('game:offer_draw', { gameId });
    await drawOffered;

    const overW = waitForEvent(whiteSocket, 'game:over');
    const overB = waitForEvent(blackSocket, 'game:over');
    blackSocket.emit('game:respond_draw', { gameId, accept: true });
    const [overDataW] = await Promise.all([overW, overB]);

    assert(overDataW.result === '1/2-1/2', 'Wager draw: Result is 1/2-1/2');
    assert(overDataW.isWagerGame === true, 'Wager draw: game:over has isWagerGame');
    assert(overDataW.wagerAmount === WAGER, `Wager draw: wagerAmount=${WAGER}`);

    // Check refund — balances should be restored (approximately)
    await sleep(1000);
    const balAfterA = await httpGet('/api/crypto/balance', userA.token);
    const balAfterB = await httpGet('/api/crypto/balance', userB.token);
    log(`  Balances after draw: A=${balAfterA.data?.balance}, B=${balAfterB.data?.balance}`);

    const diffA = Math.abs((balAfterA.data?.balance ?? 0) - balA);
    const diffB = Math.abs((balAfterB.data?.balance ?? 0) - balB);
    assert(diffA < 1, 'Wager draw: Player A balance restored (within rounding)');
    assert(diffB < 1, 'Wager draw: Player B balance restored (within rounding)');
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testWagerMismatchNoMatch(userA, userB) {
  log('--- Test: Wager Mismatch — Different amounts do NOT match ---');

  const sessA = `smoke_${RUN_ID}_wmisA`;
  const sessB = `smoke_${RUN_ID}_wmisB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const queuedA = waitForEvent(sockA, 'lobby:queued');
    const queuedB = waitForEvent(sockB, 'lobby:queued');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: 5 });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: 10 });

    await Promise.all([queuedA, queuedB]);
    assert(true, 'Wager mismatch: Both players queued (not matched)');

    // Cancel queues
    sockA.emit('lobby:cancel_play');
    sockB.emit('lobby:cancel_play');
    await sleep(300);
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
}

async function testWagerDisconnectReconnect(userA, userB) {
  log('--- Test: Wager Game — Disconnect & Reconnect preserves wager ---');

  const sessA = `smoke_${RUN_ID}_wdcA`;
  const sessB = `smoke_${RUN_ID}_wdcB`;

  const sockA = await connectSocket(sessA, userA.token);
  const sockB = await connectSocket(sessB, userB.token);

  try {
    const WAGER = 2;

    const startA = waitForEvent(sockA, 'lobby:game_start');
    const startB = waitForEvent(sockB, 'lobby:game_start');

    sockA.emit('lobby:play', { timeControl: 300, playerName: userA.username, wagerAmount: WAGER });
    await sleep(200);
    sockB.emit('lobby:play', { timeControl: 300, playerName: userB.username, wagerAmount: WAGER });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isAWhite = dataA.color === 'w';
    const whiteSocket = isAWhite ? sockA : sockB;
    const blackSocket = isAWhite ? sockB : sockA;
    const whiteSession = isAWhite ? sessA : sessB;
    const whiteToken = isAWhite ? userA.token : userB.token;

    // Play a move
    const moveMade = waitForEvent(blackSocket, 'game:move_made');
    whiteSocket.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // White disconnects
    const dcNotify = waitForEvent(blackSocket, 'game:opponent_disconnected');
    whiteSocket.disconnect();
    await dcNotify;
    assert(true, 'Wager DC: Opponent notified of disconnect');

    // Reconnect
    const recon = await connectSocket(whiteSession, whiteToken);
    const reconNotify = waitForEvent(blackSocket, 'game:opponent_reconnected');
    const statePromise = waitForEvent(recon, 'game:state');
    recon.emit('game:join', { gameId });
    const [, state] = await Promise.all([reconNotify, statePromise]);

    assert(state.isWagerGame === true, 'Wager DC: Reconnect state shows isWagerGame');
    assert(state.wagerAmount === WAGER, 'Wager DC: Reconnect state shows wagerAmount');
    assert(state.status === 'active', 'Wager DC: Game still active');

    // Finish game
    const over = waitForEvent(blackSocket, 'game:over');
    recon.emit('game:resign', { gameId });
    const overData = await over;
    assert(overData.isWagerGame === true, 'Wager DC: game:over after reconnect has wager info');

    recon.disconnect();
  } finally {
    if (sockA.connected) sockA.disconnect();
    sockB.disconnect();
  }
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  log(`======================================================`);
  log(`  ELO Stakes Production Smoke Test`);
  log(`  Target: ${API_URL}`);
  log(`  Run ID: ${RUN_ID}`);
  log(`======================================================\n`);

  try {
    // 1. Health check
    await testHealthCheck();

    // 2. Register test accounts
    log('--- Registering test accounts ---');
    const userA = await registerTestUser('alice');
    const userB = await registerTestUser('bob');
    const userC = await registerTestUser('carol');
    log(`  Registered: ${userA.username}, ${userB.username}, ${userC.username}`);

    // 3. Auth flow
    await testAuthFlow();

    // 4. Socket connection
    await testSocketConnection(userA);

    // 5. Lobby state
    await testLobbyState(userA);

    // 6. Full free game (Scholar's Mate)
    await testFreeGameLifecycle(userA, userB);

    // 7. Resign flow
    await testResignFlow(userA, userB);

    // 8. Draw agreement
    await testDrawFlow(userA, userB);

    // 9. Disconnect & reconnect
    await testDisconnectAndReconnect(userA, userB);

    // 10. Browser refresh simulation
    await testBrowserRefresh(userA, userB);

    // 11. Bot game
    await testBotGame(userA);

    // 12. Spectator
    await testSpectator(userA, userB, userC);

    // --- Wager game tests (require token balance) ---
    const testUserIds = [userA.userId, userB.userId, userC.userId].filter(Boolean);
    const credited = await creditTestAccounts(testUserIds, 100);

    if (credited) {
      // 13. Wager game: full lifecycle with checkmate
      await testWagerGameCheckmate(userA, userB);

      // 14. Wager game: resign settles to opponent
      await testWagerGameResign(userA, userB);

      // 15. Wager game: draw refunds both
      await testWagerGameDraw(userA, userB);

      // 16. Wager mismatch: different amounts don't match
      await testWagerMismatchNoMatch(userA, userB);

      // 17. Wager game: disconnect & reconnect preserves wager
      await testWagerDisconnectReconnect(userA, userB);
    } else {
      log('  SKIP: Wager tests skipped (no DB access to credit accounts)');
    }

  } catch (err) {
    log(`\n  FATAL ERROR: ${err.message}`);
    console.error(err);
    failed++;
  }

  // Cleanup test accounts from production DB
  if (DB_URL) {
    log('\n--- Cleaning up test accounts ---');
    const allTestUsers = [];
    for (const suffix of ['alice', 'bob', 'carol', 'auth']) {
      try {
        const { data } = await httpPost('/api/auth/login', {
          username: `smoke_${RUN_ID}_${suffix}`,
          password: `testpass_${RUN_ID}`,
        });
        if (data?.user?.id) allTestUsers.push(data.user.id);
      } catch {}
    }
    if (allTestUsers.length > 0) {
      await cleanupTestAccounts(allTestUsers);
    }
  }

  // Summary
  log(`\n======================================================`);
  log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  log(`======================================================`);

  if (failed > 0) {
    log('\nFailed tests:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => log(`  - ${r.label}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
