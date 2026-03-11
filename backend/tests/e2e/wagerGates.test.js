import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, waitForEvent, disconnectAll } from './helpers/createTestClient.js';

describe('E2E: Wager Gates', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableWagers: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
  });

  afterAll(async () => {
    await server.close();
  });

  it('should create a game with gates and include them in lobby state', async () => {
    const c1 = await connectClient(server.url, 'gate-sess-1');
    clients.push(c1);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 25,
      gates: { requireVerified: true },
    });

    const data = await created;
    expect(data.gameId).toBeDefined();

    // Gates should be on the pending game (sanitized with null fields)
    const pending = server.lobbyManager.pendingGames.get(data.gameId);
    expect(pending).toBeDefined();
    expect(pending.gates).toMatchObject({ requireVerified: true });
  });

  it('should reject join when gates fail (requireVerified, no accounts)', async () => {
    const creator = await connectClient(server.url, 'gate-creator-1');
    clients.push(creator);

    const created = waitForEvent(creator, 'lobby:game_created');
    creator.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 10,
      gates: { requireVerified: true },
    });
    const { gameId } = await created;

    // Pool returns no linked accounts (default mock returns empty rows)
    const joiner = await connectClient(server.url, 'gate-joiner-1');
    clients.push(joiner);

    const error = waitForEvent(joiner, 'lobby:error');
    joiner.emit('lobby:join_game', { gameId, playerName: 'Bob' });

    const errData = await error;
    expect(errData.message).toBeDefined();
    expect(errData.message).toMatch(/logged in|verified|account/i);
  });

  it('should allow join when no gates are set on wager game', async () => {
    const creator = await connectClient(server.url, 'no-gate-creator');
    clients.push(creator);

    const created = waitForEvent(creator, 'lobby:game_created');
    creator.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 10,
    });
    const { gameId } = await created;

    const joiner = await connectClient(server.url, 'no-gate-joiner');
    clients.push(joiner);

    const gameStart = waitForEvent(joiner, 'lobby:game_start');
    joiner.emit('lobby:join_game', { gameId, playerName: 'Bob' });

    const data = await gameStart;
    expect(data.gameId).toBe(gameId);
  });

  it('should allow join when gates exist but wager is 0 (free game)', async () => {
    const creator = await connectClient(server.url, 'free-gate-creator');
    clients.push(creator);

    const created = waitForEvent(creator, 'lobby:game_created');
    creator.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 0,
      gates: { requireVerified: true },
    });
    const { gameId } = await created;

    const joiner = await connectClient(server.url, 'free-gate-joiner');
    clients.push(joiner);

    const gameStart = waitForEvent(joiner, 'lobby:game_start');
    joiner.emit('lobby:join_game', { gameId, playerName: 'Bob' });

    const data = await gameStart;
    expect(data.gameId).toBe(gameId);
  });

  it('should include gates in lobby:state_update broadcast', async () => {
    const c1 = await connectClient(server.url, 'lobby-state-1');
    clients.push(c1);

    // Listen for lobby state update BEFORE emitting
    const stateP = waitForEvent(c1, 'lobby:state_update');

    c1.emit('lobby:create_game', {
      timeControl: 600,
      playerName: 'Alice',
      wagerAmount: 50,
      gates: { requireVerified: true, minExternalRating: 1500, minExternalPlatform: 'lichess', minExternalTimeControl: 'rapid' },
    });

    const state = await stateP;
    expect(state.openGames).toBeDefined();
    const game = state.openGames.find((g) => g.wagerAmount === 50);
    expect(game).toBeDefined();
    expect(game.gates).toBeDefined();
    expect(game.gates.requireVerified).toBe(true);
    expect(game.gates.minExternalRating).toBe(1500);
  });

  it('should pass gates through quick-play queue', async () => {
    const c1 = await connectClient(server.url, 'qp-gate-1');
    clients.push(c1);

    // Listen for lobby state update BEFORE emitting
    const stateP = waitForEvent(c1, 'lobby:state_update');

    c1.emit('lobby:play', {
      timeControl: 180,
      playerName: 'Alice',
      wagerAmount: 5,
      gates: { requireVerified: true },
    });

    const state = await stateP;
    expect(state.seekers).toBeDefined();
    const seeker = state.seekers.find((s) => s.playerName === 'Alice');
    expect(seeker).toBeDefined();
    expect(seeker.gates).toBeDefined();
    expect(seeker.gates.requireVerified).toBe(true);
  });
});
