import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Game Endings', () => {
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

  it('should detect stalemate', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Load a position where white can stalemate black
    // k7/2K5/8/8/8/8/8/1Q6 w — Qb6 stalemates Ka8
    const room = server.gameManager.getGame(gameId);
    room.chess.load('k7/2K5/8/8/8/8/8/1Q6 w - - 0 1');

    const overW = waitForEvent(clientW, 'game:over');
    clientW.emit('game:move', { gameId, from: 'b1', to: 'b6' });
    const data = await overW;

    expect(data.reason).toBe('stalemate');
    expect(data.result).toBe('1/2-1/2');
    expect(data.winner).toBeNull();
  });

  it('should detect insufficient material (K vs K)', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // White king captures black knight, leaving K vs K (insufficient material)
    // FEN: 8/8/8/8/8/4k3/8/4Kn2 w — Kxf1
    const room = server.gameManager.getGame(gameId);
    room.chess.load('8/8/8/8/8/4k3/8/4Kn2 w - - 0 1');

    const overW = waitForEvent(clientW, 'game:over');
    clientW.emit('game:move', { gameId, from: 'e1', to: 'f1' });
    const data = await overW;

    expect(data.reason).toBe('insufficient_material');
    expect(data.result).toBe('1/2-1/2');
    expect(data.winner).toBeNull();
  });

  it('should detect threefold repetition', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // 1.Nf3 Nf6 2.Ng1 Ng8 3.Nf3 Nf6 4.Ng1 Ng8
    // Position repeats 3 times after 4...Ng8
    const moves = [
      { player: clientW, from: 'g1', to: 'f3' }, // 1.Nf3
      { player: clientB, from: 'g8', to: 'f6' }, // 1...Nf6
      { player: clientW, from: 'f3', to: 'g1' }, // 2.Ng1
      { player: clientB, from: 'f6', to: 'g8' }, // 2...Ng8
      { player: clientW, from: 'g1', to: 'f3' }, // 3.Nf3
      { player: clientB, from: 'g8', to: 'f6' }, // 3...Nf6
      { player: clientW, from: 'f3', to: 'g1' }, // 4.Ng1
    ];

    for (const { player, from, to } of moves) {
      const moveMade = waitForEvent(clientW, 'game:move_made');
      player.emit('game:move', { gameId, from, to });
      await moveMade;
    }

    // 4...Ng8 — triggers threefold repetition
    const gameOver = waitForEvent(clientW, 'game:over');
    clientB.emit('game:move', { gameId, from: 'f6', to: 'g8' });
    const data = await gameOver;

    expect(data.reason).toBe('threefold_repetition');
    expect(data.result).toBe('1/2-1/2');
    expect(data.winner).toBeNull();
  });

  it('should send game:over to both players on stalemate', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const room = server.gameManager.getGame(gameId);
    room.chess.load('k7/2K5/8/8/8/8/8/1Q6 w - - 0 1');

    const overW = waitForEvent(clientW, 'game:over');
    const overB = waitForEvent(clientB, 'game:over');

    clientW.emit('game:move', { gameId, from: 'b1', to: 'b6' });

    const [dW, dB] = await Promise.all([overW, overB]);

    expect(dW.result).toBe('1/2-1/2');
    expect(dW.reason).toBe('stalemate');
    expect(dB.result).toBe('1/2-1/2');
    expect(dB.reason).toBe('stalemate');
  });

  it('should send game:over to spectator on draw', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'spec-draw-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    const room = server.gameManager.getGame(gameId);
    room.chess.load('k7/2K5/8/8/8/8/8/1Q6 w - - 0 1');

    const overSpec = waitForEvent(spectator, 'game:over');
    clientW.emit('game:move', { gameId, from: 'b1', to: 'b6' });
    const data = await overSpec;

    expect(data.result).toBe('1/2-1/2');
    expect(data.reason).toBe('stalemate');
    expect(data.winner).toBeNull();
  });
});
