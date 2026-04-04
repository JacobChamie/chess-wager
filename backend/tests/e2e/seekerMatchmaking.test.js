import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';

/**
 * Tests for the Open Games "seeker" matchmaking flow.
 *
 * The critical bug: when Player B clicks "Play" on a seeker in the Open Games
 * tab, the frontend must pass the seeker's wagerAmount so the backend
 * matchmaking filter (which requires exact wagerAmount match) can pair them.
 * Without it, both players sit in the queue forever.
 */
describe('E2E: Seeker Matchmaking (Open Games tab flow)', () => {
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

  // --- Core regression test for the wager seeker bug ---

  it('should match when second player passes the same wagerAmount as the seeker', async () => {
    const c1 = await connectClient(server.url, 'seeker-wager-a');
    const c2 = await connectClient(server.url, 'seeker-wager-b');
    clients.push(c1, c2);

    // Player 1 queues with 10 token wager
    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    await queued;

    // Verify seeker appears in lobby state with wager
    const stateP = waitForEvent(c2, 'lobby:state_update');
    c2.emit('lobby:get_state');
    const state = await stateP;
    const seeker = state.seekers.find(s => s.wagerAmount === 10);
    expect(seeker).toBeDefined();
    expect(seeker.playerName).toBe('Alice');

    // Player 2 clicks "Play" on the seeker — must pass same wagerAmount
    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:play', {
      timeControl: seeker.timeControl,
      playerName: 'Bob',
      wagerAmount: seeker.wagerAmount,
    });
    const [dA, dB] = await Promise.all([startA, startB]);

    expect(dA.gameId).toBe(dB.gameId);
    expect(dA.gameId).toBeDefined();
  });

  it('should NOT match when second player omits wagerAmount (the original bug)', async () => {
    const c1 = await connectClient(server.url, 'bug-wager-a');
    const c2 = await connectClient(server.url, 'bug-wager-b');
    clients.push(c1, c2);

    const queued1 = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 5 });
    await queued1;

    // Simulate the old broken behavior: second player sends NO wagerAmount
    const queued2 = waitForEvent(c2, 'lobby:queued');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });
    await queued2;

    // Both should still be in queue — no match
    const stateP = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:get_state');
    const state = await stateP;
    expect(state.seekers.length).toBe(2);
  });

  // --- Free game seeker matching ---

  it('should match free game seekers correctly', async () => {
    const c1 = await connectClient(server.url, 'free-seek-a');
    const c2 = await connectClient(server.url, 'free-seek-b');
    clients.push(c1, c2);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 0 });
    await queued;

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 0 });
    const [dA, dB] = await Promise.all([startA, startB]);

    expect(dA.gameId).toBe(dB.gameId);
  });

  it('should match free seekers when wagerAmount is undefined (default)', async () => {
    const c1 = await connectClient(server.url, 'free-undef-a');
    const c2 = await connectClient(server.url, 'free-undef-b');
    clients.push(c1, c2);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    await queued;

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });
    const [dA, dB] = await Promise.all([startA, startB]);

    expect(dA.gameId).toBe(dB.gameId);
  });

  // --- Time control matching ---

  it('should match seekers with object time controls (increment games)', async () => {
    const c1 = await connectClient(server.url, 'tc-obj-a');
    const c2 = await connectClient(server.url, 'tc-obj-b');
    clients.push(c1, c2);

    const tc = { time: 180, increment: 2 };

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: tc, playerName: 'Alice', wagerAmount: 5 });
    await queued;

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:play', { timeControl: tc, playerName: 'Bob', wagerAmount: 5 });
    const [dA, dB] = await Promise.all([startA, startB]);

    expect(dA.gameId).toBe(dB.gameId);
  });

  it('should NOT match seekers with different increments', async () => {
    const c1 = await connectClient(server.url, 'tc-diff-inc-a');
    const c2 = await connectClient(server.url, 'tc-diff-inc-b');
    clients.push(c1, c2);

    const queued1 = waitForEvent(c1, 'lobby:queued');
    const queued2 = waitForEvent(c2, 'lobby:queued');

    c1.emit('lobby:play', { timeControl: { time: 300, increment: 0 }, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: { time: 300, increment: 3 }, playerName: 'Bob' });

    await Promise.all([queued1, queued2]);
  });

  // --- Create game + join flow ---

  it('should allow creating a wager game and another player joining it', async () => {
    const c1 = await connectClient(server.url, 'create-join-a');
    const c2 = await connectClient(server.url, 'create-join-b');
    clients.push(c1, c2);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Alice',
      wagerAmount: 25,
    });
    const { gameId } = await created;

    // Verify it shows up in open games with wager info
    const stateP = waitForEvent(c2, 'lobby:state_update');
    c2.emit('lobby:get_state');
    const state = await stateP;
    const openGame = state.openGames.find(g => g.gameId === gameId);
    expect(openGame).toBeDefined();
    expect(openGame.wagerAmount).toBe(25);

    // Player 2 joins
    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:join_game', { gameId, playerName: 'Bob' });
    const [dA, dB] = await Promise.all([startA, startB]);

    expect(dA.gameId).toBe(gameId);
    expect(dB.gameId).toBe(gameId);
  });

  it('should prevent joining your own created game', async () => {
    const c1 = await connectClient(server.url, 'self-join-a');
    clients.push(c1);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'Alice' });
    const { gameId } = await created;

    const error = waitForEvent(c1, 'lobby:error');
    c1.emit('lobby:join_game', { gameId, playerName: 'Alice' });
    const data = await error;
    expect(data.message).toMatch(/own game/i);
  });

  // --- Cancel flows ---

  it('should remove player from queue on cancel', async () => {
    const c1 = await connectClient(server.url, 'cancel-queue-a');
    const c2 = await connectClient(server.url, 'cancel-queue-b');
    clients.push(c1, c2);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    await queued;

    c1.emit('lobby:cancel_play');

    // Wait a moment for cancel to process
    await new Promise(r => setTimeout(r, 100));

    // Player 2 queues with same TC + wager — should NOT match the cancelled player
    const queued2 = waitForEvent(c2, 'lobby:queued');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 10 });
    await queued2;
  });

  it('should remove pending game on cancel', async () => {
    const c1 = await connectClient(server.url, 'cancel-game-a');
    const c2 = await connectClient(server.url, 'cancel-game-b');
    clients.push(c1, c2);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'Alice' });
    const { gameId } = await created;

    c1.emit('lobby:cancel_game');
    await new Promise(r => setTimeout(r, 100));

    // Try to join cancelled game
    const error = waitForEvent(c2, 'lobby:error');
    c2.emit('lobby:join_game', { gameId, playerName: 'Bob' });
    const data = await error;
    expect(data.message).toMatch(/not found/i);
  });

  // --- Disconnect removes from queue ---

  it('should remove player from queue on disconnect', async () => {
    const c1 = await connectClient(server.url, 'dc-queue-a');
    const c2 = await connectClient(server.url, 'dc-queue-b');
    clients.push(c2);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    await queued;

    // Disconnect c1
    c1.disconnect();
    await new Promise(r => setTimeout(r, 200));

    // c2 should not match with disconnected player
    const queued2 = waitForEvent(c2, 'lobby:queued');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 10 });
    await queued2;
  });

  // --- Seeker info in lobby state ---

  it('should include all seeker fields in lobby state', async () => {
    const c1 = await connectClient(server.url, 'seeker-fields-a');
    clients.push(c1);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', {
      timeControl: { time: 180, increment: 2 },
      playerName: 'Alice',
      wagerAmount: 15,
      colorPref: 'white',
    });
    await queued;

    const stateP = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:get_state');
    const state = await stateP;

    expect(state.seekers.length).toBeGreaterThanOrEqual(1);
    const seeker = state.seekers.find(s => s.wagerAmount === 15);
    expect(seeker).toBeDefined();
    expect(seeker.playerName).toBe('Alice');
    expect(seeker.colorPref).toBe('white');
    expect(seeker.timeControl).toEqual({ time: 180, increment: 2 });
  });

  // --- Multiple seekers with different wagers ---

  it('should correctly pair seekers when multiple wager tiers exist', async () => {
    const c1 = await connectClient(server.url, 'multi-w-a');
    const c2 = await connectClient(server.url, 'multi-w-b');
    const c3 = await connectClient(server.url, 'multi-w-c');
    const c4 = await connectClient(server.url, 'multi-w-d');
    clients.push(c1, c2, c3, c4);

    // c1 and c2 want 5 token wager
    // c3 and c4 want 25 token wager
    const q1 = waitForEvent(c1, 'lobby:queued');
    const q3 = waitForEvent(c3, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'A', wagerAmount: 5 });
    c3.emit('lobby:play', { timeControl: 300, playerName: 'C', wagerAmount: 25 });
    await Promise.all([q1, q3]);

    // Now c2 matches c1 (5 tokens), c4 matches c3 (25 tokens)
    const start1 = waitForEvent(c1, 'lobby:game_start');
    const start2 = waitForEvent(c2, 'lobby:game_start');
    const start3 = waitForEvent(c3, 'lobby:game_start');
    const start4 = waitForEvent(c4, 'lobby:game_start');

    c2.emit('lobby:play', { timeControl: 300, playerName: 'B', wagerAmount: 5 });
    c4.emit('lobby:play', { timeControl: 300, playerName: 'D', wagerAmount: 25 });

    const [d1, d2, d3, d4] = await Promise.all([start1, start2, start3, start4]);

    // Each pair should share a gameId
    expect(d1.gameId).toBe(d2.gameId);
    expect(d3.gameId).toBe(d4.gameId);
    // The two games should be different
    expect(d1.gameId).not.toBe(d3.gameId);
  });

  // --- Full game playthrough after seeker match ---

  it('should allow a full game after matching via seeker wager flow', async () => {
    const c1 = await connectClient(server.url, 'full-seeker-a');
    const c2 = await connectClient(server.url, 'full-seeker-b');
    clients.push(c1, c2);

    // Seeker queues
    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    await queued;

    // Matcher joins with same wager
    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 10 });
    const [dA, dB] = await Promise.all([startA, startB]);

    const gameId = dA.gameId;
    const whiteClient = dA.color === 'w' ? c1 : c2;
    const blackClient = dA.color === 'w' ? c2 : c1;

    // Join game rooms
    const stateW = waitForEvent(whiteClient, 'game:state');
    const stateB = waitForEvent(blackClient, 'game:state');
    whiteClient.emit('game:join', { gameId });
    blackClient.emit('game:join', { gameId });
    const [sw, sb] = await Promise.all([stateW, stateB]);

    expect(sw.isWagerGame).toBe(true);
    expect(sw.wagerAmount).toBe(10);
    expect(sb.isWagerGame).toBe(true);

    // Play some moves
    let mm = waitForEvent(blackClient, 'game:move_made');
    whiteClient.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await mm;

    mm = waitForEvent(whiteClient, 'game:move_made');
    blackClient.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await mm;

    // Resign to end the game
    const overW = waitForEvent(whiteClient, 'game:over');
    const overB = waitForEvent(blackClient, 'game:over');
    blackClient.emit('game:resign', { gameId });
    const [oW, oB] = await Promise.all([overW, overB]);

    expect(oW.isWagerGame).toBe(true);
    expect(oW.wagerAmount).toBe(10);
    expect(oW.result).toBe('1-0');
    expect(oB.result).toBe('1-0');
  });

  // --- Edge cases ---

  it('should handle rapid queue/cancel/requeue cycles', async () => {
    const c1 = await connectClient(server.url, 'rapid-cycle-a');
    const c2 = await connectClient(server.url, 'rapid-cycle-b');
    clients.push(c1, c2);

    // Queue, cancel, requeue with different wager
    let queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 5 });
    await queued;

    c1.emit('lobby:cancel_play');
    await new Promise(r => setTimeout(r, 50));

    queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 25 });
    await queued;

    // c2 should match at 25, not at 5
    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 25 });
    const [dA, dB] = await Promise.all([startA, startB]);

    expect(dA.gameId).toBe(dB.gameId);
  });

  it('should handle re-queuing with same socket (replaces old entry)', async () => {
    const c1 = await connectClient(server.url, 'requeue-a');
    const c2 = await connectClient(server.url, 'requeue-b');
    clients.push(c1, c2);

    // Queue at 5 tokens
    let queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 5 });
    await queued;

    // Re-queue at 10 tokens (should replace, not duplicate)
    queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 10 });
    await queued;

    // Verify only one seeker entry
    const stateP = waitForEvent(c1, 'lobby:state_update');
    c1.emit('lobby:get_state');
    const state = await stateP;
    const aliceSeekers = state.seekers.filter(s => s.playerName === 'Alice');
    expect(aliceSeekers.length).toBe(1);
    expect(aliceSeekers[0].wagerAmount).toBe(10);
  });

  it('should match when both players use custom wager amounts', async () => {
    const c1 = await connectClient(server.url, 'custom-w-a');
    const c2 = await connectClient(server.url, 'custom-w-b');
    clients.push(c1, c2);

    const startA = waitForEvent(c1, 'lobby:game_start');
    const startB = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice', wagerAmount: 42 });
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob', wagerAmount: 42 });

    const [dA, dB] = await Promise.all([startA, startB]);
    expect(dA.gameId).toBe(dB.gameId);
  });
});
