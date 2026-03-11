import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { GameManager } from '../../src/game/GameManager.js';
import { LobbyManager } from '../../src/lobby/LobbyManager.js';
import { registerHandlers } from '../../src/socket/handlers.js';
import { createMockPool } from '../helpers/mockPool.js';

/**
 * Create a test server that supports premium auth users.
 * Pass sessionId as auth.sessionId + optional auth.isPremium and auth.userId.
 */
async function createPremiumTestServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const pool = createMockPool();
  const gameManager = new GameManager(pool);
  const lobbyManager = new LobbyManager(gameManager);

  gameManager.persistGame = vi.fn().mockResolvedValue(undefined);

  io.on('connection', (socket) => {
    const sessionId = socket.handshake.auth?.sessionId;
    if (!sessionId) { socket.disconnect(true); return; }

    // Build authUser from handshake — enables premium testing
    let authUser = null;
    if (socket.handshake.auth?.userId) {
      authUser = {
        id: socket.handshake.auth.userId,
        username: socket.handshake.auth.username || sessionId,
        is_premium: socket.handshake.auth.isPremium || false,
        is_admin: socket.handshake.auth.isAdmin || false,
      };
    }

    registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser, null, null, pool);

    socket.on('disconnect', () => {});
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  return {
    url: `http://localhost:${port}`,
    io,
    httpServer,
    gameManager,
    lobbyManager,
    close() {
      return new Promise((resolve) => {
        for (const [, room] of gameManager.games) room.destroy();
        gameManager.games.clear();
        io.close(() => resolve());
      });
    },
  };
}

function connectPremiumClient(url, sessionId, opts = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioc(url, {
      auth: {
        sessionId,
        userId: opts.userId || null,
        username: opts.username || sessionId,
        isPremium: opts.isPremium || false,
        isAdmin: opts.isAdmin || false,
      },
      forceNew: true,
      transports: ['websocket'],
    });
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('Connection timeout')); }, 5000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitForEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timeout waiting for "${event}"`)); }, timeout);
    const handler = (data) => { clearTimeout(timer); resolve(data); };
    socket.once(event, handler);
  });
}

function disconnectAll(clients) {
  return Promise.all(clients.map((c) => new Promise((resolve) => {
    if (c.disconnected) { resolve(); return; }
    c.on('disconnect', resolve);
    c.disconnect();
  })));
}

describe('E2E: Premium Features', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createPremiumTestServer();
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
  });

  afterAll(async () => {
    await server.close();
  });

  it('premium user should appear as isPremium in seekers list', async () => {
    const c1 = await connectPremiumClient(server.url, 'prem-seeker', { userId: 'u1', isPremium: true });
    clients.push(c1);

    const statePromise = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'PremUser' });
    const state = await statePromise;

    const seeker = state.seekers.find((s) => s.playerName === 'PremUser');
    expect(seeker).toBeTruthy();
    expect(seeker.isPremium).toBe(true);
  });

  it('premium user should appear as isPremium in open games', async () => {
    const c1 = await connectPremiumClient(server.url, 'prem-creator', { userId: 'u2', isPremium: true });
    clients.push(c1);

    const statePromise = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'PremCreator' });
    const state = await statePromise;

    const game = state.openGames.find((g) => g.creatorName === 'PremCreator');
    expect(game).toBeTruthy();
    expect(game.isPremium).toBe(true);
  });

  it('non-premium user should have isPremium=false in seekers', async () => {
    const c1 = await connectPremiumClient(server.url, 'free-seeker', { userId: 'u3', isPremium: false });
    clients.push(c1);

    const statePromise = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'FreeUser' });
    const state = await statePromise;

    const seeker = state.seekers.find((s) => s.playerName === 'FreeUser');
    expect(seeker).toBeTruthy();
    expect(seeker.isPremium).toBe(false);
  });

  it('game state should include whiteIsPremium and blackIsPremium', async () => {
    const c1 = await connectPremiumClient(server.url, 'prem-game-w', { userId: 'uw1', isPremium: true });
    const c2 = await connectPremiumClient(server.url, 'prem-game-b', { userId: 'ub1', isPremium: false });
    clients.push(c1, c2);

    const start1 = waitForEvent(c1, 'lobby:game_start');
    const start2 = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'PremW' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'FreeB' });

    const [d1, d2] = await Promise.all([start1, start2]);
    const gameId = d1.gameId;

    // Join game to get full state
    const statePromise = waitForEvent(c1, 'game:state');
    c1.emit('game:join', { gameId });
    const state = await statePromise;

    expect(state).toHaveProperty('whiteIsPremium');
    expect(state).toHaveProperty('blackIsPremium');
    // One should be true, one false
    const flags = [state.whiteIsPremium, state.blackIsPremium].sort();
    expect(flags).toEqual([false, true]);
  });

  it('premium player chat should include isPremium flag', async () => {
    const c1 = await connectPremiumClient(server.url, 'chat-prem-w', { userId: 'cw1', isPremium: true });
    const c2 = await connectPremiumClient(server.url, 'chat-free-b', { userId: 'cb1', isPremium: false });
    clients.push(c1, c2);

    const start1 = waitForEvent(c1, 'lobby:game_start');
    const start2 = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'ChatPrem' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'ChatFree' });

    const [d1] = await Promise.all([start1, start2]);
    const gameId = d1.gameId;

    // Both join the game room
    c1.emit('game:join', { gameId });
    c2.emit('game:join', { gameId });

    // Wait for state so sockets are joined to room
    await waitForEvent(c1, 'game:state');
    await waitForEvent(c2, 'game:state');

    // Send chat from premium player
    const chatPromise = waitForEvent(c2, 'chat:message');
    c1.emit('chat:send', { gameId, message: 'Hello from premium!' });
    const msg = await chatPromise;

    expect(msg.senderName).toBeTruthy();
    expect(msg.isPremium).toBe(true);
  });

  it('active games should include premium flags', async () => {
    const c1 = await connectPremiumClient(server.url, 'active-prem-w', { userId: 'aw1', isPremium: true });
    const c2 = await connectPremiumClient(server.url, 'active-free-b', { userId: 'ab1', isPremium: false });
    const c3 = await connectPremiumClient(server.url, 'active-observer', {});
    clients.push(c1, c2, c3);

    const start1 = waitForEvent(c1, 'lobby:game_start');
    const start2 = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'ActivePrem' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'ActiveFree' });

    await Promise.all([start1, start2]);

    // Observer requests lobby state
    const statePromise = waitForEvent(c3, 'lobby:state_update');
    c3.emit('lobby:get_state');
    const state = await statePromise;

    expect(state.activeGames.length).toBeGreaterThanOrEqual(1);
    const game = state.activeGames[0];
    expect(game).toHaveProperty('whiteIsPremium');
    expect(game).toHaveProperty('blackIsPremium');
  });

  it('premium seeker appears with isPremium flag in seekers list', async () => {
    // Queue a premium player with a unique time control so they stay in queue
    const cPrem = await connectPremiumClient(server.url, 'prio-prem', { userId: 'pp1', isPremium: true });
    clients.push(cPrem);

    const premQueued = waitForEvent(cPrem, 'lobby:queued');
    cPrem.emit('lobby:play', { timeControl: 180, playerName: 'PremWaiter' });
    await premQueued;

    // Observer checks lobby state — premium seeker should have isPremium=true
    const cObs = await connectPremiumClient(server.url, 'prio-obs', {});
    clients.push(cObs);

    const statePromise = waitForEvent(cObs, 'lobby:state_update');
    cObs.emit('lobby:get_state');
    const state = await statePromise;

    const seeker = state.seekers.find((s) => s.playerName === 'PremWaiter');
    expect(seeker).toBeTruthy();
    expect(seeker.isPremium).toBe(true);
  });
});
