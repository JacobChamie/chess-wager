import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent, collectEvents } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

/**
 * Comprehensive E2E playthrough tests verifying full game flows,
 * clock accuracy, and edge cases.
 */
describe('E2E: Full Playthrough', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
  });

  afterAll(async () => {
    await server.close();
  });

  // --- Complete game flows ---

  it('should play Scholar\'s Mate and verify every move state is consistent', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const moves = [
      { player: clientW, from: 'e2', to: 'e4', expectedSan: 'e4', expectedTurn: 'b' },
      { player: clientB, from: 'e7', to: 'e5', expectedSan: 'e5', expectedTurn: 'w' },
      { player: clientW, from: 'd1', to: 'h5', expectedSan: 'Qh5', expectedTurn: 'b' },
      { player: clientB, from: 'b8', to: 'c6', expectedSan: 'Nc6', expectedTurn: 'w' },
      { player: clientW, from: 'f1', to: 'c4', expectedSan: 'Bc4', expectedTurn: 'b' },
      { player: clientB, from: 'g8', to: 'f6', expectedSan: 'Nf6', expectedTurn: 'w' },
    ];

    for (const { player, from, to, expectedSan, expectedTurn } of moves) {
      const moveMade = waitForEvent(clientW, 'game:move_made');
      player.emit('game:move', { gameId, from, to });
      const data = await moveMade;
      expect(data.san).toBe(expectedSan);
      expect(data.turn).toBe(expectedTurn);
      expect(data.fen).toBeDefined();
      expect(data.whiteTime).toBeGreaterThan(0);
      expect(data.blackTime).toBeGreaterThan(0);
    }

    // Checkmate move
    const gameOverW = waitForEvent(clientW, 'game:over');
    const gameOverB = waitForEvent(clientB, 'game:over');
    clientW.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    const [resultW, resultB] = await Promise.all([gameOverW, gameOverB]);

    expect(resultW.result).toBe('1-0');
    expect(resultW.reason).toBe('checkmate');
    expect(resultW.winner).toBe('w');
    expect(resultB.result).toBe('1-0');
  });

  it('should play Fool\'s Mate (fastest checkmate) correctly', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // 1. f3 e5 2. g4 Qh4#
    let moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'f2', to: 'f3' });
    await moveMade;

    moveMade = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await moveMade;

    moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'g2', to: 'g4' });
    await moveMade;

    const gameOver = waitForEvent(clientW, 'game:over');
    clientB.emit('game:move', { gameId, from: 'd8', to: 'h4' });
    const result = await gameOver;

    expect(result.result).toBe('0-1');
    expect(result.reason).toBe('checkmate');
    expect(result.winner).toBe('b');
  });

  it('should handle pawn promotion', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Get initial state to manipulate
    const state = waitForEvent(clientW, 'game:state');
    clientW.emit('game:join', { gameId });
    await state;

    // Play a series of moves leading to a position where promotion is possible
    // Use a shorter approach: just verify the server accepts promotion parameter
    const moves = [
      { p: clientW, from: 'e2', to: 'e4' },
      { p: clientB, from: 'd7', to: 'd5' },
      { p: clientW, from: 'e4', to: 'd5' },
      { p: clientB, from: 'c7', to: 'c6' },
      { p: clientW, from: 'd5', to: 'c6' },
      { p: clientB, from: 'e7', to: 'e6' },
      { p: clientW, from: 'c6', to: 'b7' },
      { p: clientB, from: 'f7', to: 'f6' },
    ];

    for (const { p, from, to } of moves) {
      const mm = waitForEvent(clientW, 'game:move_made');
      p.emit('game:move', { gameId, from, to });
      await mm;
    }

    // Promote pawn to queen
    const promoMove = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'b7', to: 'a8', promotion: 'q' });
    const data = await promoMove;
    expect(data.san).toContain('=Q');
  });

  // --- Clock accuracy tests ---

  it('should have decreasing active clock and stable inactive clock', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 10 });
    clients.push(clientW, clientB);

    // White's turn: collect 3 clock updates
    const updates = await collectEvents(clientW, 'game:clock_update', 3, 6000);

    // whiteTime should decrease (white is active)
    expect(updates[2].whiteTime).toBeLessThan(updates[0].whiteTime);
    // blackTime should stay constant (not ticking)
    expect(updates[0].blackTime).toBeCloseTo(updates[2].blackTime, -2);
  });

  it('should properly switch active clock after each move', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: { time: 30, increment: 0 },
    });
    clients.push(clientW, clientB);

    // Make white's move
    let moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const moveData1 = await moveMade;

    // After white's move, both times should be <= 30000
    expect(moveData1.whiteTime).toBeLessThanOrEqual(30000);
    expect(moveData1.blackTime).toBeLessThanOrEqual(30000);

    // Wait a bit, then check clock update — black should be ticking
    const update1 = await waitForEvent(clientW, 'game:clock_update', 3000);
    expect(update1.blackTime).toBeLessThan(30000);

    // Make black's move
    moveMade = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    const moveData2 = await moveMade;

    // Now white should be ticking again
    const update2 = await waitForEvent(clientW, 'game:clock_update', 3000);
    expect(update2.whiteTime).toBeLessThan(moveData2.whiteTime);
  });

  it('should add increment correctly on each move', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: { time: 60, increment: 5 },
    });
    clients.push(clientW, clientB);

    // Verify the clock was constructed with the correct increment
    const room = server.gameManager.getGame(gameId);
    expect(room.clock.incrementMs).toBe(5000);
    expect(room.timeControl.increment).toBe(5);

    // White moves quickly, should get +5s increment
    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await moveMade;

    // Time = initialTime - elapsed + increment; on slow CI elapsed can equal
    // the increment, so use >= to handle the boundary
    expect(data.whiteTime).toBeGreaterThanOrEqual(60000);
    expect(data.whiteTime).toBeLessThanOrEqual(65100);

    // Black moves quickly too
    const moveMade2 = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    const data2 = await moveMade2;

    expect(data2.blackTime).toBeGreaterThanOrEqual(60000);
    expect(data2.blackTime).toBeLessThanOrEqual(65100);
  });

  // --- Error handling ---

  it('should reject out-of-turn moves gracefully', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Black tries to move first
    const invalid = waitForEvent(clientB, 'game:invalid_move');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    const data = await invalid;
    expect(data.message).toMatch(/not your turn/i);
  });

  it('should reject illegal moves without crashing the game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Try illegal move
    const invalid = waitForEvent(clientW, 'game:invalid_move');
    clientW.emit('game:move', { gameId, from: 'e1', to: 'e5' });
    await invalid;

    // Game should still work — play a legal move
    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await moveMade;
    expect(data.san).toBe('e4');
  });

  it('should reject moves after game is over', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Resign
    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await gameOver;

    // Try to move
    const invalid = waitForEvent(clientW, 'game:invalid_move', 2000).catch(() => null);
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    // Should not get a move_made event
    const moveMade = waitForEvent(clientW, 'game:move_made', 1000).catch(() => 'timeout');
    const result = await moveMade;
    expect(result).toBe('timeout');
  });

  // --- Draw and resign flows ---

  it('should handle draw offer and accept flow', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Play at least one move first
    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // White offers draw
    const drawOffer = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    const offerData = await drawOffer;
    expect(offerData.offeredBy).toBe('w');

    // Black accepts
    const gameOver = waitForEvent(clientW, 'game:over');
    clientB.emit('game:respond_draw', { gameId, accept: true });
    const result = await gameOver;

    expect(result.result).toBe('1/2-1/2');
    expect(result.reason).toBe('draw_agreement');
    expect(result.winner).toBeNull();
  });

  it('should handle draw offer and decline flow', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    const drawOffer = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    await drawOffer;

    const declined = waitForEvent(clientW, 'game:draw_declined');
    clientB.emit('game:respond_draw', { gameId, accept: false });
    await declined;

    // Game should continue — black can still move
    const moveMade2 = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    const data = await moveMade2;
    expect(data.san).toBe('e5');
  });

  it('should clear draw offer when a move is made', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const mm = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await mm;

    // Black offers draw
    const drawOffer = waitForEvent(clientW, 'game:draw_offered');
    clientB.emit('game:offer_draw', { gameId });
    await drawOffer;

    // Black makes a move (implicitly declines own draw? actually, the opponent moves)
    // White makes a move (implicitly ignores the draw offer)
    const mm2 = waitForEvent(clientB, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await mm2;

    // Rejoin to get fresh state — draw offer should be cleared
    const state = waitForEvent(clientW, 'game:state');
    clientW.emit('game:join', { gameId });
    const s = await state;
    expect(s.drawOffer).toBeFalsy();
  });

  it('should handle resign from white', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const gameOverW = waitForEvent(clientW, 'game:over');
    const gameOverB = waitForEvent(clientB, 'game:over');
    clientW.emit('game:resign', { gameId });
    const [resultW, resultB] = await Promise.all([gameOverW, gameOverB]);

    expect(resultW.result).toBe('0-1');
    expect(resultW.reason).toBe('resign');
    expect(resultW.winner).toBe('b');
    expect(resultB.result).toBe('0-1');
  });

  it('should handle resign from black', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const gameOver = waitForEvent(clientW, 'game:over');
    clientB.emit('game:resign', { gameId });
    const result = await gameOver;

    expect(result.result).toBe('1-0');
    expect(result.reason).toBe('resign');
    expect(result.winner).toBe('w');
  });

  // --- Rematch flow ---

  it('should handle rematch offer, accept, and start new game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // End current game
    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await gameOver;

    // White offers rematch
    const rematchOffer = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    const offerData = await rematchOffer;
    expect(offerData.offeredBy).toBe('w');

    // Black accepts
    const rematchStartW = waitForEvent(clientW, 'game:rematch_start');
    const rematchStartB = waitForEvent(clientB, 'game:rematch_start');
    clientB.emit('game:respond_rematch', { gameId, accept: true });
    const [rsW, rsB] = await Promise.all([rematchStartW, rematchStartB]);

    expect(rsW.gameId).toBeDefined();
    expect(rsW.gameId).not.toBe(gameId);
    expect(rsB.gameId).toBe(rsW.gameId);
    // Colors should swap
    expect(rsW.color).toBeDefined();
    expect(rsB.color).toBeDefined();
  });

  it('should handle rematch decline', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await gameOver;

    const rematchOffer = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    await rematchOffer;

    const declined = waitForEvent(clientW, 'game:rematch_declined');
    clientB.emit('game:respond_rematch', { gameId, accept: false });
    await declined;
  });

  // --- Move history ---

  it('should include complete move history with FEN and time', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    let mm = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    let data = await mm;

    expect(data.moves).toHaveLength(1);
    expect(data.moves[0].moveNumber).toBe(1);
    expect(data.moves[0].white.san).toBe('e4');
    expect(data.moves[0].white.fen).toBeDefined();
    expect(data.moves[0].white.timeMs).toBeGreaterThanOrEqual(0);
    expect(data.moves[0].black).toBeNull();

    mm = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    data = await mm;

    expect(data.moves[0].black.san).toBe('e5');
    expect(data.moves[0].black.fen).toBeDefined();

    mm = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'd2', to: 'd4' });
    data = await mm;

    expect(data.moves).toHaveLength(2);
    expect(data.moves[1].moveNumber).toBe(2);
    expect(data.moves[1].white.san).toBe('d4');
  });

  // --- Spectator tests ---

  it('should allow spectators to join and see game state', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Spectator joins
    const spectator = await connectClient(server.url, `spec-${Date.now()}`);
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    const data = await state;

    expect(data.gameId).toBe(gameId);
    expect(data.myColor).toBeNull(); // spectator
    expect(data.status).toBe('active');
  });

  it('should broadcast spectator count updates', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, `spec-${Date.now()}`);
    clients.push(spectator);

    const countUpdate = waitForEvent(clientW, 'game:spectators_update');
    const specState = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await specState;
    const update = await countUpdate;

    expect(update.count).toBe(1);
  });

  it('should broadcast moves to spectators', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, `spec-${Date.now()}`);
    clients.push(spectator);

    const specState = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await specState;

    const specMove = waitForEvent(spectator, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await specMove;

    expect(data.san).toBe('e4');
    expect(data.fen).toBeDefined();
  });

  // --- Reconnection tests ---

  it('should allow player to reconnect and resume game', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Play a move
    const mm = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await mm;

    // Disconnect white
    const disconnectNotice = waitForEvent(clientB, 'game:opponent_disconnected');
    clientW.disconnect();
    await disconnectNotice;

    // Reconnect with same session
    const newClient = await connectClient(server.url, sessionW);
    clients.push(newClient);

    const reconnectNotice = waitForEvent(clientB, 'game:opponent_reconnected');
    const state = waitForEvent(newClient, 'game:state');
    newClient.emit('game:join', { gameId });
    const [_, stateData] = await Promise.all([reconnectNotice, state]);

    expect(stateData.status).toBe('active');
    expect(stateData.myColor).toBe('w');
    // FEN should reflect the move that was made
    expect(stateData.fen).not.toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('should preserve clock times across reconnection', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url, {
      timeControl: { time: 30, increment: 0 },
    });
    clients.push(clientW, clientB);

    // Wait a bit for some time to elapse
    await new Promise(r => setTimeout(r, 1500));

    // Disconnect and reconnect
    clientW.disconnect();
    const newClient = await connectClient(server.url, sessionW);
    clients.push(newClient);

    const state = waitForEvent(newClient, 'game:state');
    newClient.emit('game:join', { gameId });
    const data = await state;

    // White time should be less than 30s
    expect(data.whiteTime).toBeLessThan(30000);
    expect(data.whiteTime).toBeGreaterThan(25000);
    // Black time should be exactly 30s (not their turn)
    expect(data.blackTime).toBe(30000);
  });

  // --- Chat tests ---

  it('should deliver chat messages between players', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const chatMsg = waitForEvent(clientB, 'chat:message');
    clientW.emit('chat:send', { gameId, message: 'Good luck!' });
    const msg = await chatMsg;

    expect(msg.message).toBe('Good luck!');
    expect(msg.senderName).toBeDefined();
  });

  it('should include chat history in game state on rejoin', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const chatMsg = waitForEvent(clientB, 'chat:message');
    clientW.emit('chat:send', { gameId, message: 'Hello' });
    await chatMsg;

    // Rejoin
    const state = waitForEvent(clientW, 'game:state');
    clientW.emit('game:join', { gameId });
    const data = await state;

    expect(data.chatMessages.length).toBeGreaterThanOrEqual(1);
    expect(data.chatMessages[0].message).toBe('Hello');
  });

  it('should sanitize HTML in chat messages', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const chatMsg = waitForEvent(clientB, 'chat:message');
    clientW.emit('chat:send', { gameId, message: '<script>alert("xss")</script>' });
    const msg = await chatMsg;

    expect(msg.message).not.toContain('<script>');
    expect(msg.message).toContain('&lt;script&gt;');
  });
});

describe('E2E: Stress Tests', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
  });

  afterAll(async () => {
    await server.close();
  });

  it('should handle rapid-fire moves without state corruption', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Play 10 moves as fast as possible
    const fastMoves = [
      { p: clientW, from: 'e2', to: 'e4' },
      { p: clientB, from: 'e7', to: 'e5' },
      { p: clientW, from: 'd2', to: 'd4' },
      { p: clientB, from: 'd7', to: 'd5' },
      { p: clientW, from: 'g1', to: 'f3' },
      { p: clientB, from: 'g8', to: 'f6' },
      { p: clientW, from: 'b1', to: 'c3' },
      { p: clientB, from: 'b8', to: 'c6' },
      { p: clientW, from: 'f1', to: 'd3' },
      { p: clientB, from: 'f8', to: 'd6' },
    ];

    for (const { p, from, to } of fastMoves) {
      const mm = waitForEvent(clientW, 'game:move_made');
      p.emit('game:move', { gameId, from, to });
      await mm;
    }

    // Verify final state
    const state = waitForEvent(clientW, 'game:state');
    clientW.emit('game:join', { gameId });
    const data = await state;

    expect(data.status).toBe('active');
    expect(data.moves.length).toBe(5); // 5 full move pairs
    expect(data.moves[4].white.san).toBe('Bd3');
    expect(data.moves[4].black.san).toBe('Bd6');
  });

  it('should handle multiple concurrent games', async () => {
    const games = await Promise.all([
      matchAndJoin(server.url, { timeControl: 300, nameA: 'G1-W', nameB: 'G1-B' }),
      matchAndJoin(server.url, { timeControl: 300, nameA: 'G2-W', nameB: 'G2-B' }),
      matchAndJoin(server.url, { timeControl: 300, nameA: 'G3-W', nameB: 'G3-B' }),
    ]);

    for (const g of games) {
      clients.push(g.clientW, g.clientB);
    }

    // Make a move in each game simultaneously
    const movePromises = games.map(g => {
      const mm = waitForEvent(g.clientB, 'game:move_made');
      g.clientW.emit('game:move', { gameId: g.gameId, from: 'e2', to: 'e4' });
      return mm;
    });

    const results = await Promise.all(movePromises);
    results.forEach(r => {
      expect(r.san).toBe('e4');
      expect(r.turn).toBe('b');
    });
  });

  it('should handle rapid connect/disconnect cycles', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientB);

    // Rapid disconnect/reconnect 3 times
    for (let i = 0; i < 3; i++) {
      clientW.disconnect();
      await new Promise(r => setTimeout(r, 100));
      const reconnected = await connectClient(server.url, sessionW);
      const state = waitForEvent(reconnected, 'game:state');
      reconnected.emit('game:join', { gameId });
      const data = await state;
      expect(data.status).toBe('active');
      if (i < 2) reconnected.disconnect();
      else clients.push(reconnected);
    }
  });

  it('should handle 5 spectators joining simultaneously', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    const spectators = [];
    const joinPromises = [];

    for (let i = 0; i < 5; i++) {
      const s = await connectClient(server.url, `mass-spec-${i}-${Date.now()}`);
      spectators.push(s);
      clients.push(s);
      const stateP = waitForEvent(s, 'game:state');
      s.emit('game:join', { gameId });
      joinPromises.push(stateP);
    }

    const states = await Promise.all(joinPromises);
    states.forEach(s => {
      expect(s.myColor).toBeNull();
      expect(s.status).toBe('active');
    });

    // Wait for spectator count to propagate
    await new Promise(r => setTimeout(r, 200));
    const state = waitForEvent(clientW, 'game:state');
    clientW.emit('game:join', { gameId });
    const data = await state;
    expect(data.spectatorCount).toBe(5);
  });

  it('should handle game with 0 increment and very fast moves', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: { time: 60, increment: 0 },
    });
    clients.push(clientW, clientB);

    // Rapid opening moves
    const moves = [
      { p: clientW, from: 'e2', to: 'e4' },
      { p: clientB, from: 'e7', to: 'e5' },
      { p: clientW, from: 'g1', to: 'f3' },
      { p: clientB, from: 'b8', to: 'c6' },
    ];

    for (const { p, from, to } of moves) {
      const mm = waitForEvent(clientW, 'game:move_made');
      p.emit('game:move', { gameId, from, to });
      const data = await mm;
      // Both times should be positive
      expect(data.whiteTime).toBeGreaterThan(0);
      expect(data.blackTime).toBeGreaterThan(0);
    }
  });

  it('should handle back-to-back resign and rematch', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, { timeControl: 300 });
    clients.push(clientW, clientB);

    // Game 1: resign
    let gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await gameOver;

    // Rematch
    const rematchOffer = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    await rematchOffer;

    const rematchStartW = waitForEvent(clientW, 'game:rematch_start');
    const rematchStartB = waitForEvent(clientB, 'game:rematch_start');
    clientB.emit('game:respond_rematch', { gameId, accept: true });
    const [rsW, rsB] = await Promise.all([rematchStartW, rematchStartB]);

    const newGameId = rsW.gameId;

    // Join the new game
    const stateW = waitForEvent(clientW, 'game:state');
    const stateB = waitForEvent(clientB, 'game:state');
    clientW.emit('game:join', { gameId: newGameId });
    clientB.emit('game:join', { gameId: newGameId });
    const [sw, sb] = await Promise.all([stateW, stateB]);

    expect(sw.status).toBe('active');
    expect(sb.status).toBe('active');
    expect(sw.gameId).toBe(newGameId);
  });
});
