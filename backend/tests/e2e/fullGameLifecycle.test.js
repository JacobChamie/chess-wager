import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, waitForEvent, disconnectAll, disconnectClient } from './helpers/createTestClient.js';

describe('E2E: Full Game Lifecycle — Wager to Payout', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableWagers: true, enableBots: true, enableFairPlay: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    for (const [, room] of server.gameManager.games) {
      room.destroy();
    }
    server.gameManager.games.clear();
  });

  afterAll(async () => {
    await server.close();
  });

  // ---------------------------------------------------------------
  // 1. Full wager game: matchmake -> play Scholar's Mate -> payout
  // ---------------------------------------------------------------

  it('should run a complete wager game from matchmaking through checkmate to settlement', { timeout: 15000 }, async () => {
    const c1 = await connectClient(server.url, 'life-w-1', {
      authUser: { id: 'u1', username: 'Alice' },
    });
    const c2 = await connectClient(server.url, 'life-w-2', {
      authUser: { id: 'u2', username: 'Bob' },
    });
    clients.push(c1, c2);

    // Step 1: Both players queue with matching wager
    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 25 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 25 });

    const [dataA, dataB] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;
    expect(dataA.gameId).toBe(dataB.gameId);

    // Step 2: Verify wager was locked
    expect(server.wagerService.lockWager).toHaveBeenCalledWith(
      gameId, expect.any(String), expect.any(String), 25
    );

    // Step 3: Join the game room and verify state
    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    const statePromise = waitForEvent(whiteClient, 'game:state');
    whiteClient.emit('game:join', { gameId });
    const state = await statePromise;

    expect(state.isWagerGame).toBe(true);
    expect(state.wagerAmount).toBe(25);
    expect(state.status).toBe('active');

    // Step 4: Play Scholar's Mate (1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#)
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
        'game:move_made'
      );
      client.emit('game:move', { gameId, from, to });
      await movePromise;
    }

    // Step 5: Deliver checkmate (generous timeout — fairplay analysis adds async overhead)
    const T = 10000;
    const overW = waitForEvent(whiteClient, 'game:over', T);
    const overB = waitForEvent(blackClient, 'game:over', T);
    whiteClient.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    // Step 6: Verify game over with wager info
    expect(overDataW.reason).toBe('checkmate');
    expect(overDataW.result).toBe('1-0');
    expect(overDataW.winner).toBe('w');
    expect(overDataW.isWagerGame).toBe(true);
    expect(overDataW.wagerAmount).toBe(25);

    expect(overDataB.reason).toBe('checkmate');
    expect(overDataB.isWagerGame).toBe(true);

    // Step 7: Verify wager settlement was called
    expect(server.wagerService.settleWager).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // 2. Wager game ending in draw — both players refunded
  // ---------------------------------------------------------------

  it('should refund both players on a drawn wager game', async () => {
    const c1 = await connectClient(server.url, 'draw-life-a', {
      authUser: { id: 'u3', username: 'Charlie' },
    });
    const c2 = await connectClient(server.url, 'draw-life-b', {
      authUser: { id: 'u4', username: 'Dana' },
    });
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Charlie', wagerAmount: 50 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Dana', wagerAmount: 50 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // Play one move so the game is underway
    const moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // White offers draw
    const drawOffered = waitForEvent(blackClient, 'game:draw_offered');
    whiteClient.emit('game:offer_draw', { gameId });
    await drawOffered;

    // Black accepts draw
    const overW = waitForEvent(whiteClient, 'game:over');
    const overB = waitForEvent(blackClient, 'game:over');
    blackClient.emit('game:respond_draw', { gameId, accept: true });

    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    expect(overDataW.result).toBe('1/2-1/2');
    expect(overDataW.reason).toBe('draw_agreement');
    expect(overDataW.isWagerGame).toBe(true);
    expect(overDataW.wagerAmount).toBe(50);

    // Verify settlement was called with isDraw=true
    expect(server.wagerService.settleWager).toHaveBeenCalledWith(
      gameId, expect.any(String), expect.any(String), 50, true
    );
  });

  // ---------------------------------------------------------------
  // 3. Wager game: resign triggers payout to opponent
  // ---------------------------------------------------------------

  it('should settle wager to winner on resignation', async () => {
    const c1 = await connectClient(server.url, 'resign-life-a', {
      authUser: { id: 'u5', username: 'Eve' },
    });
    const c2 = await connectClient(server.url, 'resign-life-b', {
      authUser: { id: 'u6', username: 'Frank' },
    });
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Eve', wagerAmount: 15 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Frank', wagerAmount: 15 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // Play a couple moves
    let moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    moveMade = waitForEvent(whiteClient, 'game:move_made');
    blackClient.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await moveMade;

    // Black resigns
    server.wagerService.settleWager.mockClear();
    const overW = waitForEvent(whiteClient, 'game:over');
    const overB = waitForEvent(blackClient, 'game:over');
    blackClient.emit('game:resign', { gameId });

    const [overDataW, overDataB] = await Promise.all([overW, overB]);

    expect(overDataW.result).toBe('1-0');
    expect(overDataW.reason).toBe('resign');
    expect(overDataW.winner).toBe('w');
    expect(overDataW.isWagerGame).toBe(true);
    expect(overDataW.wagerAmount).toBe(15);

    // Settlement: winner gets paid, not a draw
    expect(server.wagerService.settleWager).toHaveBeenCalledWith(
      gameId, expect.any(String), expect.any(String), 15, false
    );
  });

  // ---------------------------------------------------------------
  // 4. Create/join flow with wager — alternative to matchmaking
  // ---------------------------------------------------------------

  it('should support create_game -> join_game wager flow with full payout', async () => {
    const c1 = await connectClient(server.url, 'create-join-a', {
      authUser: { id: 'u7', username: 'Grace' },
    });
    const c2 = await connectClient(server.url, 'create-join-b', {
      authUser: { id: 'u8', username: 'Hank' },
    });
    clients.push(c1, c2);

    // Creator creates a wager game
    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Grace',
      wagerAmount: 30,
    });
    const { gameId } = await created;

    // Joiner joins
    const startCreator = waitForEvent(c1, 'lobby:game_start');
    const startJoiner = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:join_game', { gameId, playerName: 'Hank' });

    const [dCreator, dJoiner] = await Promise.all([startCreator, startJoiner]);
    expect(dCreator.gameId).toBe(dJoiner.gameId);

    // Verify lock was called
    expect(server.wagerService.lockWager).toHaveBeenCalledWith(
      gameId, expect.any(String), expect.any(String), 30
    );

    // Play one move then resign to finish
    const whiteClient = dCreator.color === 'w' ? c1 : c2;
    const blackClient = dCreator.color === 'w' ? c2 : c1;

    const moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'd2', to: 'd4' });
    await moveMade;

    const over = waitForEvent(whiteClient, 'game:over');
    blackClient.emit('game:resign', { gameId });
    const data = await over;

    expect(data.isWagerGame).toBe(true);
    expect(data.wagerAmount).toBe(30);
    expect(data.winner).toBe('w');
  });

  // ---------------------------------------------------------------
  // 5. Wager lock failure prevents game start
  // ---------------------------------------------------------------

  it('should abort game if wager lock fails (insufficient balance)', async () => {
    server.wagerService.lockWager.mockResolvedValueOnce({
      success: false,
      error: 'White player has insufficient balance',
    });

    const c1 = await connectClient(server.url, 'lock-fail-a', {
      authUser: { id: 'u9', username: 'Iris' },
    });
    const c2 = await connectClient(server.url, 'lock-fail-b', {
      authUser: { id: 'u10', username: 'Jack' },
    });
    clients.push(c1, c2);

    const errorPromise = waitForEvent(c1, 'lobby:error', 5000).catch(() => null);
    const errorPromise2 = waitForEvent(c2, 'lobby:error', 5000).catch(() => null);

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Iris', wagerAmount: 9999 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Jack', wagerAmount: 9999 });

    // At least one client should receive the error
    const [err1, err2] = await Promise.all([errorPromise, errorPromise2]);
    const error = err1 || err2;
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/insufficient/i);

    // Restore the mock
    server.wagerService.lockWager.mockResolvedValue({ success: true });
  });
});

describe('E2E: Disconnect Mid-Game (Wager)', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableWagers: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    for (const [, room] of server.gameManager.games) {
      room.destroy();
    }
    server.gameManager.games.clear();
  });

  afterAll(async () => {
    await server.close();
  });

  // ---------------------------------------------------------------
  // 6. Disconnect mid-game in a wager game — opponent notified
  // ---------------------------------------------------------------

  it('should notify opponent of disconnect in a wager game and preserve game state', async () => {
    const c1 = await connectClient(server.url, 'dc-wager-a', {
      authUser: { id: 'u11', username: 'Kate' },
    });
    const c2 = await connectClient(server.url, 'dc-wager-b', {
      authUser: { id: 'u12', username: 'Leo' },
    });
    clients.push(c2); // c1 will be manually disconnected

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Kate', wagerAmount: 20 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Leo', wagerAmount: 20 });

    const [dataA, dataB] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;
    const whiteSession = dataA.color === 'w' ? 'dc-wager-a' : 'dc-wager-b';

    // Make a move first
    const moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // White disconnects
    const dcNotify = waitForEvent(blackClient, 'game:opponent_disconnected');
    await disconnectClient(whiteClient);
    const dcData = await dcNotify;

    expect(dcData.timeout).toBe(60);

    // Game should still be active (waiting for reconnect or timeout)
    const room = server.gameManager.getGame(gameId);
    expect(room.status).toBe('active');
    expect(room.isWagerGame).toBe(true);
  });

  // ---------------------------------------------------------------
  // 7. Disconnect then reconnect — continue wager game
  // ---------------------------------------------------------------

  it('should allow reconnection and continued play in a wager game', async () => {
    const c1 = await connectClient(server.url, 'rc-wager-a', {
      authUser: { id: 'u13', username: 'Mia' },
    });
    const c2 = await connectClient(server.url, 'rc-wager-b', {
      authUser: { id: 'u14', username: 'Ned' },
    });
    clients.push(c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Mia', wagerAmount: 10 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Ned', wagerAmount: 10 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isC1White = dataA.color === 'w';
    const whiteClient = isC1White ? c1 : c2;
    const blackClient = isC1White ? c2 : c1;
    const whiteSession = isC1White ? 'rc-wager-a' : 'rc-wager-b';

    // White plays e4
    let moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // White disconnects
    const dcNotify = waitForEvent(blackClient, 'game:opponent_disconnected');
    await disconnectClient(whiteClient);
    await dcNotify;

    // White reconnects with same session
    const whiteReconnected = await connectClient(server.url, whiteSession);
    clients.push(whiteReconnected);

    const reconnected = waitForEvent(blackClient, 'game:opponent_reconnected');
    const statePromise = waitForEvent(whiteReconnected, 'game:state');
    whiteReconnected.emit('game:join', { gameId });

    const [, state] = await Promise.all([reconnected, statePromise]);

    // Verify full state was received after reconnect
    expect(state.status).toBe('active');
    expect(state.isWagerGame).toBe(true);
    expect(state.wagerAmount).toBe(10);
    expect(state.moves).toHaveLength(1);
    expect(state.myColor).toBe('w');
    expect(state.fen).not.toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    // Continue the game — black plays e5
    moveMade = waitForEvent(whiteReconnected, 'game:move_made');
    blackClient.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await moveMade;

    // White resigns after reconnect — settlement should still work
    const overB = waitForEvent(blackClient, 'game:over');
    const overW = waitForEvent(whiteReconnected, 'game:over');
    whiteReconnected.emit('game:resign', { gameId });

    const [overDataB, overDataW] = await Promise.all([overB, overW]);
    expect(overDataB.isWagerGame).toBe(true);
    expect(overDataB.wagerAmount).toBe(10);
    expect(overDataB.winner).toBe('b');
  });

  // ---------------------------------------------------------------
  // 8. Abandonment timeout forfeits wager game
  // ---------------------------------------------------------------

  it('should forfeit wager game on disconnect timeout and settle to remaining player', async () => {
    const c1 = await connectClient(server.url, 'abandon-a', {
      authUser: { id: 'u15', username: 'Olivia' },
    });
    const c2 = await connectClient(server.url, 'abandon-b', {
      authUser: { id: 'u16', username: 'Pete' },
    });
    clients.push(c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Olivia', wagerAmount: 35 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Pete', wagerAmount: 35 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isC1White = dataA.color === 'w';
    const whiteClient = isC1White ? c1 : c2;
    const blackClient = isC1White ? c2 : c1;

    // Patch timeout to 200ms for test speed
    const room = server.gameManager.getGame(gameId);
    room.handleDisconnect = function (sessionId) {
      if (this.status !== 'active') return;
      this.disconnectTimers[sessionId] = setTimeout(() => {
        const color = this.getPlayerColor(sessionId);
        if (color && this.status === 'active') {
          const winnerColor = color === 'w' ? 'b' : 'w';
          const result = this._endGame(
            winnerColor === 'w' ? '1-0' : '0-1',
            'abandonment',
            winnerColor
          );
          this.onGameOver?.(result);
        }
      }, 200);
    };

    // White disconnects
    const gameOver = waitForEvent(blackClient, 'game:over', 5000);
    await disconnectClient(whiteClient);

    const data = await gameOver;
    expect(data.reason).toBe('abandonment');
    expect(data.winner).toBe('b');
    expect(data.isWagerGame).toBe(true);
    expect(data.wagerAmount).toBe(35);
  });
});

describe('E2E: Browser Refresh During Move', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableWagers: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    for (const [, room] of server.gameManager.games) {
      room.destroy();
    }
    server.gameManager.games.clear();
  });

  afterAll(async () => {
    await server.close();
  });

  // ---------------------------------------------------------------
  // 9. Simulate browser refresh: disconnect + immediate reconnect
  // ---------------------------------------------------------------

  it('should survive a browser refresh (disconnect + quick reconnect) with no data loss', async () => {
    const c1 = await connectClient(server.url, 'refresh-a');
    const c2 = await connectClient(server.url, 'refresh-b');
    clients.push(c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isC1White = dataA.color === 'w';
    const whiteClient = isC1White ? c1 : c2;
    const blackClient = isC1White ? c2 : c1;
    const whiteSession = isC1White ? 'refresh-a' : 'refresh-b';

    // Play two moves
    let moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    moveMade = waitForEvent(whiteClient, 'game:move_made');
    blackClient.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await moveMade;

    // Simulate browser refresh: disconnect white instantly
    await disconnectClient(whiteClient);

    // Immediately reconnect (simulates browser page reload)
    const refreshed = await connectClient(server.url, whiteSession);
    clients.push(refreshed);

    const statePromise = waitForEvent(refreshed, 'game:state');
    refreshed.emit('game:join', { gameId });
    const state = await statePromise;

    // Full state should be preserved
    expect(state.status).toBe('active');
    expect(state.moves).toHaveLength(1); // 1 move pair (e4, e5)
    expect(state.moves[0].white.san).toBe('e4');
    expect(state.moves[0].black.san).toBe('e5');
    expect(state.myColor).toBe('w');
    expect(state.turn).toBe('w'); // White's turn again

    // Disconnect timer should be cancelled
    const room = server.gameManager.getGame(gameId);
    expect(room.disconnectTimers[whiteSession]).toBeUndefined();

    // Game should continue normally — white plays d4
    moveMade = waitForEvent(blackClient, 'game:move_made');
    refreshed.emit('game:move', { gameId, from: 'd2', to: 'd4' });
    const moveData = await moveMade;

    expect(moveData.san).toBe('d4');
    expect(moveData.turn).toBe('b');
  });

  // ---------------------------------------------------------------
  // 10. Both players refresh simultaneously
  // ---------------------------------------------------------------

  it('should handle both players refreshing at the same time', async () => {
    const c1 = await connectClient(server.url, 'dualref-a');
    const c2 = await connectClient(server.url, 'dualref-b');

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isC1White = dataA.color === 'w';
    const whiteClient = isC1White ? c1 : c2;
    const blackClient = isC1White ? c2 : c1;

    // Play a move
    const moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Both disconnect simultaneously
    await Promise.all([disconnectClient(c1), disconnectClient(c2)]);

    // Both reconnect
    const r1 = await connectClient(server.url, 'dualref-a');
    const r2 = await connectClient(server.url, 'dualref-b');
    clients.push(r1, r2);

    const state1 = waitForEvent(r1, 'game:state');
    const state2 = waitForEvent(r2, 'game:state');
    r1.emit('game:join', { gameId });
    r2.emit('game:join', { gameId });

    const [s1, s2] = await Promise.all([state1, state2]);

    expect(s1.status).toBe('active');
    expect(s2.status).toBe('active');
    expect(s1.gameId).toBe(gameId);
    expect(s2.gameId).toBe(gameId);
    expect(s1.moves).toHaveLength(1);
    expect(s2.moves).toHaveLength(1);
  });

  // ---------------------------------------------------------------
  // 11. Refresh during opponent's turn — clocks preserved
  // ---------------------------------------------------------------

  it('should preserve clock times across a browser refresh', async () => {
    const c1 = await connectClient(server.url, 'clock-ref-a');
    const c2 = await connectClient(server.url, 'clock-ref-b');
    clients.push(c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const isC1White = dataA.color === 'w';
    const whiteSession = isC1White ? 'clock-ref-a' : 'clock-ref-b';

    const whiteClient = isC1White ? c1 : c2;
    const blackClient = isC1White ? c2 : c1;

    // Make a move so black's clock starts
    const moveMade = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Record times before refresh
    const room = server.gameManager.getGame(gameId);
    const timesBefore = room.clock.getTimesMs();

    // White refreshes
    await disconnectClient(whiteClient);
    const refreshed = await connectClient(server.url, whiteSession);
    clients.push(refreshed);

    const statePromise = waitForEvent(refreshed, 'game:state');
    refreshed.emit('game:join', { gameId });
    const state = await statePromise;

    // Clocks should be close to what they were (allow some tolerance for test timing)
    expect(state.whiteTime).toBeGreaterThan(timesBefore.whiteTime - 2000);
    expect(state.blackTime).toBeGreaterThan(0);
    expect(state.blackTime).toBeLessThanOrEqual(300000);
  });
});

describe('E2E: Bot Game via Admin Stress-Test Tools', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableBots: true, enableWagers: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    for (const [, room] of server.gameManager.games) {
      room.destroy();
    }
    server.gameManager.games.clear();
  });

  afterAll(async () => {
    await server.close();
  });

  // ---------------------------------------------------------------
  // 12. Bot game: full lifecycle — start, play, checkmate/resign
  // ---------------------------------------------------------------

  it('should play a complete bot game from start to finish', { timeout: 15000 }, async () => {
    const client = await connectClient(server.url, 'bot-full-1');
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'beginner',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const startData = await gameStart;
    const gameId = startData.gameId;

    expect(startData.color).toBe('w');
    expect(startData.personality.id).toBe('beginner');

    // Join room
    const state = waitForEvent(client, 'game:state');
    client.emit('game:join', { gameId });
    const stateData = await state;
    expect(stateData.isBotGame).toBe(true);

    // Play e4, wait for bot response
    let moveMade = waitForEvent(client, 'game:move_made');
    client.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    const botMove = waitForEvent(client, 'game:move_made', 10000);
    await botMove;

    // Resign to end the game
    const gameOver = waitForEvent(client, 'game:over');
    client.emit('game:resign', { gameId });
    const overData = await gameOver;

    expect(overData.reason).toBe('resign');
    expect(overData.winner).toBe('b');
  });

  // ---------------------------------------------------------------
  // 13. Bot game: disconnect and reconnect mid-game
  // ---------------------------------------------------------------

  it('should allow reconnection to a bot game after disconnect', { timeout: 15000 }, async () => {
    const client = await connectClient(server.url, 'bot-dc-1');

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'beginner',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const startData = await gameStart;
    const gameId = startData.gameId;

    // Join and make a move
    const state = waitForEvent(client, 'game:state');
    client.emit('game:join', { gameId });
    await state;

    let moveMade = waitForEvent(client, 'game:move_made');
    client.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Wait for bot to respond
    const botMove = waitForEvent(client, 'game:move_made', 10000);
    await botMove;

    // Disconnect
    await disconnectClient(client);

    // Reconnect with same session
    const reconnected = await connectClient(server.url, 'bot-dc-1');
    clients.push(reconnected);

    const stateAfter = waitForEvent(reconnected, 'game:state');
    reconnected.emit('game:join', { gameId });
    const reconState = await stateAfter;

    expect(reconState.status).toBe('active');
    expect(reconState.isBotGame).toBe(true);
    expect(reconState.myColor).toBe('w');
    expect(reconState.moves.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------
  // 14. Bot personalities are all available
  // ---------------------------------------------------------------

  it('should list all bot personalities for the stress-test panel', async () => {
    const client = await connectClient(server.url, 'bot-list-1');
    clients.push(client);

    const personalities = waitForEvent(client, 'bot:personalities');
    client.emit('bot:get_personalities');
    const data = await personalities;

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    for (const p of data) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('rating');
    }
  });

  // ---------------------------------------------------------------
  // 15. Multiple concurrent bot games (stress-test simulation)
  // ---------------------------------------------------------------

  it('should handle multiple bot games running concurrently', { timeout: 15000 }, async () => {
    const sessions = ['stress-bot-1', 'stress-bot-2', 'stress-bot-3'];
    const gameIds = [];

    for (const session of sessions) {
      const client = await connectClient(server.url, session);
      clients.push(client);

      const gameStart = waitForEvent(client, 'bot:game_start');
      client.emit('bot:start_game', {
        personalityId: 'beginner',
        timeControl: { time: 300, increment: 0 },
        playerName: `Player_${session}`,
        colorPref: 'white',
      });
      const startData = await gameStart;
      gameIds.push(startData.gameId);

      // Join game room
      const state = waitForEvent(client, 'game:state');
      client.emit('game:join', { gameId: startData.gameId });
      await state;
    }

    // All three games should be distinct and active
    expect(new Set(gameIds).size).toBe(3);

    for (const gameId of gameIds) {
      const room = server.gameManager.getGame(gameId);
      expect(room).toBeDefined();
      expect(room.status).toBe('active');
      expect(room.isBotGame).toBe(true);
    }

    // Each player makes a move
    for (let i = 0; i < sessions.length; i++) {
      const client = clients[i];
      const gameId = gameIds[i];

      const moveMade = waitForEvent(client, 'game:move_made');
      client.emit('game:move', { gameId, from: 'e2', to: 'e4' });
      await moveMade;
    }

    // Resign all games
    for (let i = 0; i < sessions.length; i++) {
      const client = clients[i];
      const gameId = gameIds[i];

      const gameOver = waitForEvent(client, 'game:over');
      client.emit('game:resign', { gameId });
      await gameOver;
    }
  });

  // ---------------------------------------------------------------
  // 16. Bot game draw offer is auto-declined
  // ---------------------------------------------------------------

  it('should auto-decline draw offers in bot games (no exploit for free draws)', async () => {
    const client = await connectClient(server.url, 'bot-draw-exploit');
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'beginner',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const startData = await gameStart;
    const gameId = startData.gameId;

    const state = waitForEvent(client, 'game:state');
    client.emit('game:join', { gameId });
    await state;

    // Try to offer draw — should be auto-declined
    const declined = waitForEvent(client, 'game:draw_declined');
    client.emit('game:offer_draw', { gameId });
    await declined;

    // Game should still be active
    const room = server.gameManager.getGame(gameId);
    expect(room.status).toBe('active');
    expect(room.drawOffer).toBeNull();
  });
});

describe('E2E: Edge Cases — Rapid Actions & Race Conditions', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableWagers: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    for (const [, room] of server.gameManager.games) {
      room.destroy();
    }
    server.gameManager.games.clear();
  });

  afterAll(async () => {
    await server.close();
  });

  // ---------------------------------------------------------------
  // 17. Move after resign is rejected
  // ---------------------------------------------------------------

  it('should reject moves after resignation in a wager game', async () => {
    const c1 = await connectClient(server.url, 'post-resign-a', {
      authUser: { id: 'u17', username: 'Quinn' },
    });
    const c2 = await connectClient(server.url, 'post-resign-b', {
      authUser: { id: 'u18', username: 'Rosa' },
    });
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Quinn', wagerAmount: 10 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Rosa', wagerAmount: 10 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // White resigns
    const over = waitForEvent(whiteClient, 'game:over');
    whiteClient.emit('game:resign', { gameId });
    await over;

    // Try to make a move on the completed game
    const invalid = waitForEvent(whiteClient, 'game:invalid_move');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await invalid;
    expect(data.message).toMatch(/not active/i);
  });

  // ---------------------------------------------------------------
  // 18. Double-resign is harmless
  // ---------------------------------------------------------------

  it('should silently ignore a second resign on a completed game', async () => {
    const c1 = await connectClient(server.url, 'dblresign-a');
    const c2 = await connectClient(server.url, 'dblresign-b');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const over = waitForEvent(c1, 'game:over');
    c1.emit('game:resign', { gameId });
    await over;

    // Second resign — should not crash or emit another game:over
    c1.emit('game:resign', { gameId });
    c2.emit('game:resign', { gameId });

    // Wait a beat to confirm no errors
    await new Promise((r) => setTimeout(r, 300));

    const room = server.gameManager.getGame(gameId);
    expect(room.status).toBe('completed');
  });

  // ---------------------------------------------------------------
  // 19. Spectator joins mid-game and sees correct wager state
  // ---------------------------------------------------------------

  it('should show wager info to spectators joining mid-game', async () => {
    const c1 = await connectClient(server.url, 'spec-wager-a', {
      authUser: { id: 'u19', username: 'Sam' },
    });
    const c2 = await connectClient(server.url, 'spec-wager-b', {
      authUser: { id: 'u20', username: 'Tina' },
    });
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Sam', wagerAmount: 40 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Tina', wagerAmount: 40 });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    // A spectator joins
    const spec = await connectClient(server.url, 'spec-viewer-1');
    clients.push(spec);

    const statePromise = waitForEvent(spec, 'game:state');
    spec.emit('game:join', { gameId });
    const state = await statePromise;

    expect(state.isWagerGame).toBe(true);
    expect(state.wagerAmount).toBe(40);
    expect(state.myColor).toBeNull(); // spectator
    expect(state.status).toBe('active');
  });

  // ---------------------------------------------------------------
  // 20. Rapid moves don't corrupt state
  // ---------------------------------------------------------------

  it('should handle rapid alternating moves without state corruption', async () => {
    const c1 = await connectClient(server.url, 'rapid-a');
    const c2 = await connectClient(server.url, 'rapid-b');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });

    const [dataA] = await Promise.all([startA, startB]);
    const gameId = dataA.gameId;

    const whiteClient = dataA.color === 'w' ? c1 : c2;
    const blackClient = dataA.color === 'w' ? c2 : c1;

    // Play several moves rapidly — always wait on whiteClient to avoid race conditions
    const rapidMoves = [
      { client: whiteClient, from: 'e2', to: 'e4' },
      { client: blackClient, from: 'e7', to: 'e5' },
      { client: whiteClient, from: 'g1', to: 'f3' },
      { client: blackClient, from: 'b8', to: 'c6' },
      { client: whiteClient, from: 'f1', to: 'b5' },
      { client: blackClient, from: 'a7', to: 'a6' },
    ];

    for (const { client, from, to } of rapidMoves) {
      const moveMade = waitForEvent(whiteClient, 'game:move_made');
      client.emit('game:move', { gameId, from, to });
      await moveMade;
    }

    // Verify state integrity
    const room = server.gameManager.getGame(gameId);
    expect(room.status).toBe('active');
    expect(room.moveHistory).toHaveLength(3); // 3 move pairs
    expect(room.chess.history()).toHaveLength(6); // 6 half-moves total
  });
});
