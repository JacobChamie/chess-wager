import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, waitForEvent, disconnectAll } from './helpers/createTestClient.js';

describe('E2E: Wager Games', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableWagers: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    // Destroy game rooms to clear clock intervals accumulated from previous tests
    for (const [, room] of server.gameManager.games) {
      room.destroy();
    }
    server.gameManager.games.clear();
  });

  afterAll(async () => {
    await server.close();
  });

  it('should include wagerAmount in lobby:play matchmaking', async () => {
    const c1 = await connectClient(server.url, 'wager-a-1');
    const c2 = await connectClient(server.url, 'wager-b-1');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 10 });

    const [dataA, dataB] = await Promise.all([startA, startB]);
    expect(dataA.gameId).toBe(dataB.gameId);
  });

  it('should NOT match players with different wager amounts', async () => {
    const c1 = await connectClient(server.url, 'wager-c-1');
    const c2 = await connectClient(server.url, 'wager-d-1');
    clients.push(c1, c2);

    const queued1 = waitForEvent(c1, 'lobby:queued');
    const queued2 = waitForEvent(c2, 'lobby:queued');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 25 });

    // Both should be queued (no match)
    await Promise.all([queued1, queued2]);
  });

  it('should match free games with each other (wagerAmount: 0)', async () => {
    const c1 = await connectClient(server.url, 'free-a-1');
    const c2 = await connectClient(server.url, 'free-b-1');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 0 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 0 });

    const [dataA, dataB] = await Promise.all([startA, startB]);
    expect(dataA.gameId).toBe(dataB.gameId);
  });

  it('should include wager info in game state', async () => {
    const c1 = await connectClient(server.url, 'ws-a-1');
    const c2 = await connectClient(server.url, 'ws-b-1');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 50 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 50 });

    const [dataA] = await Promise.all([startA, startB]);

    // Join the game and check state
    const statePromise = waitForEvent(c1, 'game:state');
    c1.emit('game:join', { gameId: dataA.gameId });
    const state = await statePromise;

    expect(state.isWagerGame).toBe(true);
    expect(state.wagerAmount).toBe(50);
  });

  it('should create a pending wager game via lobby:create_game', async () => {
    const c1 = await connectClient(server.url, 'create-w-1');
    clients.push(c1);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 25,
    });
    const data = await created;
    expect(data.gameId).toBeDefined();

    // Verify the room has wager info
    const room = server.gameManager.getGame(data.gameId);
    expect(room.isWagerGame).toBe(true);
    expect(room.wagerAmount).toBe(25);
  });

  it('should include wagerAmount in open games list', async () => {
    const c1 = await connectClient(server.url, 'list-w-1');
    clients.push(c1);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 15,
    });
    await created;

    // Request lobby state
    const statePromise = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:get_state');
    const state = await statePromise;

    const openGames = state.openGames;
    const wagerGame = openGames.find((g) => g.wagerAmount === 15);
    expect(wagerGame).toBeDefined();
    expect(wagerGame.creatorName).toBe('Alice');
  });

  it('should play a full wager game and emit game:over with wager info (resign)', async () => {
    const c1 = await connectClient(server.url, 'full-w-a');
    const c2 = await connectClient(server.url, 'full-w-b');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 10 });

    const [dataA, dataB] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    // Determine who is white
    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // White makes a move
    const movePromise = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await movePromise;

    // Black resigns
    const overA = waitForEvent(whiteClient, 'game:over');
    const overB = waitForEvent(blackClient, 'game:over');
    blackClient.emit('game:resign', { gameId });

    const [overDataA, overDataB] = await Promise.all([overA, overB]);

    // Both should see wager info in game:over
    expect(overDataA.isWagerGame).toBe(true);
    expect(overDataA.wagerAmount).toBe(10);
    expect(overDataB.isWagerGame).toBe(true);
    expect(overDataB.wagerAmount).toBe(10);
    expect(overDataA.winner).toBeDefined();
  });

  it('should emit wager info on checkmate game:over', { timeout: 30000 }, async () => {
    const c1 = await connectClient(server.url, 'cm-w-a');
    const c2 = await connectClient(server.url, 'cm-w-b');
    clients.push(c1, c2);

    const T = 15000; // generous timeout for parallel CI
    const startA = waitForEvent(c1, 'lobby:game_start', T);
    const startB = waitForEvent(c2, 'lobby:game_start', T);

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 5 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 5 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // Play Scholar's mate
    const moves = [
      { client: whiteClient, from: 'e2', to: 'e4' },
      { client: blackClient, from: 'e7', to: 'e5' },
      { client: whiteClient, from: 'd1', to: 'h5' },
      { client: blackClient, from: 'b8', to: 'c6' },
      { client: whiteClient, from: 'f1', to: 'c4' },
      { client: blackClient, from: 'g8', to: 'f6' },
    ];

    for (const { client, from, to } of moves) {
      const movePromise = waitForEvent(
        client === whiteClient ? blackClient : whiteClient,
        'game:move_made',
        T
      );
      client.emit('game:move', { gameId, from, to });
      await movePromise;
    }

    // Checkmate move
    const overW = waitForEvent(whiteClient, 'game:over', T);
    const overB = waitForEvent(blackClient, 'game:over', T);
    whiteClient.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    expect(overDataW.reason).toBe('checkmate');
    expect(overDataW.isWagerGame).toBe(true);
    expect(overDataW.wagerAmount).toBe(5);
    expect(overDataB.isWagerGame).toBe(true);
  });

  it('should emit wager info on draw agreement', async () => {
    const c1 = await connectClient(server.url, 'draw-w-a');
    const c2 = await connectClient(server.url, 'draw-w-b');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 20 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 20 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // White offers draw
    const drawOffered = waitForEvent(blackClient, 'game:draw_offered');
    whiteClient.emit('game:offer_draw', { gameId });
    await drawOffered;

    // Black accepts
    const overW = waitForEvent(whiteClient, 'game:over');
    const overB = waitForEvent(blackClient, 'game:over');
    blackClient.emit('game:respond_draw', { gameId, accept: true });

    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    expect(overDataW.result).toBe('1/2-1/2');
    expect(overDataW.isWagerGame).toBe(true);
    expect(overDataW.wagerAmount).toBe(20);
    expect(overDataB.isWagerGame).toBe(true);
  });

  it('should NOT match wager games with free games', async () => {
    const c1 = await connectClient(server.url, 'nomix-a');
    const c2 = await connectClient(server.url, 'nomix-b');
    clients.push(c1, c2);

    const queued1 = waitForEvent(c1, 'lobby:queued');
    const queued2 = waitForEvent(c2, 'lobby:queued');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' }); // no wager (defaults to 0)

    // Both should stay queued
    await Promise.all([queued1, queued2]);
  });

  it('should include wager info in seekers list', async () => {
    const c1 = await connectClient(server.url, 'seeker-w-1');
    clients.push(c1);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 42 });
    await queued;

    const statePromise = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:get_state');
    const state = await statePromise;

    const seeker = state.seekers.find((s) => s.wagerAmount === 42);
    expect(seeker).toBeDefined();
    expect(seeker.playerName).toBe('Alice');
  });
});
