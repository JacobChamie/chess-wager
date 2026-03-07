import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Gameplay', () => {
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

  it('should emit game:state on game:join', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const state = waitForEvent(clientW, 'game:state');
    clientW.emit('game:join', { gameId });
    const data = await state;

    expect(data.gameId).toBe(gameId);
    expect(data.status).toBe('active');
    expect(data.fen).toBeDefined();
    expect(data.myColor).toBe('w');
    expect(data.whiteName).toBeDefined();
    expect(data.blackName).toBeDefined();
  });

  it('should broadcast a valid move to both players', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const moveW = waitForEvent(clientW, 'game:move_made');
    const moveB = waitForEvent(clientB, 'game:move_made');

    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });

    const [dW, dB] = await Promise.all([moveW, moveB]);

    expect(dW.san).toBe('e4');
    expect(dW.from).toBe('e2');
    expect(dW.to).toBe('e4');
    expect(dW.turn).toBe('b');
    expect(dW.fen).toBeDefined();
    expect(dB.san).toBe('e4');
  });

  it('should reject a move when it is not the player\'s turn', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const invalid = waitForEvent(clientB, 'game:invalid_move');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    const data = await invalid;

    expect(data.message).toMatch(/not your turn/i);
  });

  it('should reject an illegal move', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const invalid = waitForEvent(clientW, 'game:invalid_move');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e5' });
    const data = await invalid;

    expect(data.message).toMatch(/illegal/i);
  });

  it('should detect Scholar\'s Mate checkmate', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Scholar's Mate: 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#
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

    // Final move — checkmate
    const gameOver = waitForEvent(clientW, 'game:over');
    clientW.emit('game:move', { gameId, from: 'h5', to: 'f7' });
    const data = await gameOver;

    expect(data.result).toBe('1-0');
    expect(data.reason).toBe('checkmate');
    expect(data.winner).toBe('w');
  });

  it('should include move history in game:move_made', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Play 1. e4 e5
    let moveMade = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    let data = await moveMade;

    expect(data.moves).toHaveLength(1);
    expect(data.moves[0].moveNumber).toBe(1);
    expect(data.moves[0].white.san).toBe('e4');
    expect(data.moves[0].black).toBeNull();

    moveMade = waitForEvent(clientW, 'game:move_made');
    clientB.emit('game:move', { gameId, from: 'e7', to: 'e5' });
    data = await moveMade;

    expect(data.moves).toHaveLength(1);
    expect(data.moves[0].black.san).toBe('e5');
  });
});
