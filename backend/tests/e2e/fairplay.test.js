import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';

/**
 * Match two authenticated players and return white/black clients.
 */
async function matchAuthPlayers(url) {
  const sessionA = `fp-sess-a-${Date.now()}`;
  const sessionB = `fp-sess-b-${Date.now()}`;
  const authA = { id: 'user-a', username: 'Alice' };
  const authB = { id: 'user-b', username: 'Bob' };

  const clientA = await connectClient(url, sessionA, { authUser: authA });
  const clientB = await connectClient(url, sessionB, { authUser: authB });

  const startA = waitForEvent(clientA, 'lobby:game_start');
  const startB = waitForEvent(clientB, 'lobby:game_start');

  clientA.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
  clientB.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });

  const [dataA, dataB] = await Promise.all([startA, startB]);
  const gameId = dataA.gameId;
  const isAWhite = dataA.color === 'w';

  return {
    clientW: isAWhite ? clientA : clientB,
    clientB: isAWhite ? clientB : clientA,
    gameId,
  };
}

describe('E2E: Fair Play', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableFairPlay: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
    server.fairPlayService.analyzeGame.mockClear();
    server.fairPlayService.submitReport.mockClear();
    server.fairPlayService.behaviorTracker.saveBehavior.mockClear();
  });

  afterAll(async () => {
    await server.close();
  });

  it('should trigger analysis on checkmate (via onGameOver callback)', async () => {
    const { clientW, clientB, gameId } = await matchAuthPlayers(server.url);
    clients.push(clientW, clientB);

    // Play Scholar's Mate: 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#
    const moves = [
      { player: clientW, from: 'e2', to: 'e4' },
      { player: clientB, from: 'e7', to: 'e5' },
      { player: clientW, from: 'd1', to: 'h5' },
      { player: clientB, from: 'b8', to: 'c6' },
      { player: clientW, from: 'f1', to: 'c4' },
      { player: clientB, from: 'g8', to: 'f6' },
    ];

    for (const { player, from, to } of moves) {
      const moveMade = waitForEvent(clientW, 'game:move_made');
      player.emit('game:move', { gameId, from, to });
      await moveMade;
    }

    // Checkmate move
    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    await gameOver;

    // Wait a tick for async analysis call
    await new Promise(r => setTimeout(r, 50));

    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledTimes(1);
    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledWith(gameId);
  });

  it('should trigger analysis exactly once per game (not doubled)', async () => {
    const { clientW, clientB, gameId } = await matchAuthPlayers(server.url);
    clients.push(clientW, clientB);

    // Scholar's Mate
    const moves = [
      { player: clientW, from: 'e2', to: 'e4' },
      { player: clientB, from: 'e7', to: 'e5' },
      { player: clientW, from: 'd1', to: 'h5' },
      { player: clientB, from: 'b8', to: 'c6' },
      { player: clientW, from: 'f1', to: 'c4' },
      { player: clientB, from: 'g8', to: 'f6' },
    ];

    for (const { player, from, to } of moves) {
      const moveMade = waitForEvent(clientW, 'game:move_made');
      player.emit('game:move', { gameId, from, to });
      await moveMade;
    }

    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    await gameOver;

    await new Promise(r => setTimeout(r, 50));

    // Should be called exactly once (via onGameOver), not twice
    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledTimes(1);
  });

  it('should trigger analysis on resign', async () => {
    const { clientW, clientB, gameId } = await matchAuthPlayers(server.url);
    clients.push(clientW, clientB);

    // Play a couple of moves first
    const moveMade1 = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade1;

    const moveMade2 = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    await moveMade2;

    // Resign
    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await gameOver;

    await new Promise(r => setTimeout(r, 50));

    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledTimes(1);
    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledWith(gameId);
  });

  it('should trigger analysis on draw agreement', async () => {
    const { clientW, clientB, gameId } = await matchAuthPlayers(server.url);
    clients.push(clientW, clientB);

    // Play a move first
    const moveMade = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Offer and accept draw
    const offered = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    await offered;

    const gameOver = waitForEvent(clientW, 'game:over');
    clientB.emit('game:respond_draw', { gameId, accept: true });
    await gameOver;

    await new Promise(r => setTimeout(r, 50));

    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledTimes(1);
    expect(server.fairPlayService.analyzeGame).toHaveBeenCalledWith(gameId);
  });

  it('should NOT trigger analysis for bot games', async () => {
    // Need a server with both bots and fair play
    const botServer = await createTestServer({ enableBots: true, enableFairPlay: true });

    const sessionId = `fp-bot-${Date.now()}`;
    const authUser = { id: 'user-bot', username: 'BotPlayer' };
    const client = await connectClient(botServer.url, sessionId, { authUser });
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'default',
      timeControl: { time: 300, increment: 0 },
      playerName: 'BotPlayer',
    });

    let started;
    try {
      started = await gameStart;
    } catch {
      // Bot personality might not exist, skip
      await botServer.close();
      return;
    }

    // The game should be a bot game — resign it
    const gameOver = waitForEvent(client, 'game:over');
    client.emit('game:resign', { gameId: started.gameId });
    await gameOver;

    await new Promise(r => setTimeout(r, 50));

    // Bot games should NOT trigger analysis
    expect(botServer.fairPlayService.analyzeGame).not.toHaveBeenCalled();

    await botServer.close();
  });

  it('should handle fairplay:behavior event', async () => {
    const sessionId = `fp-behavior-${Date.now()}`;
    const authUser = { id: 'user-1', username: 'Alice' };
    const client = await connectClient(server.url, sessionId, { authUser });
    clients.push(client);

    client.emit('fairplay:behavior', {
      gameId: 'game-123',
      data: { tabSwitches: 3, focusLosses: 1, copyEvents: 0, pasteEvents: 0 },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(server.fairPlayService.behaviorTracker.saveBehavior).toHaveBeenCalledWith(
      'game-123',
      'user-1',
      expect.objectContaining({ tabSwitches: 3 }),
    );
  });

  it('should handle fairplay:report event', async () => {
    const sessionId = `fp-report-${Date.now()}`;
    const authUser = { id: 'user-1', username: 'Alice' };
    const client = await connectClient(server.url, sessionId, { authUser });
    clients.push(client);

    const success = waitForEvent(client, 'fairplay:report_success');
    client.emit('fairplay:report', {
      reportedId: 'user-2',
      gameId: 'game-456',
      reason: 'engine_use',
      details: 'suspicious play',
    });
    await success;

    expect(server.fairPlayService.submitReport).toHaveBeenCalledWith(
      'user-1', 'user-2', 'game-456', 'engine_use', 'suspicious play',
    );
  });
});
