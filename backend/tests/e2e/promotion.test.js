import { createTestServer } from './helpers/createTestServer.js';
import { disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Pawn Promotion', () => {
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

  // FEN: white pawn on a7, ready to promote
  const PROMO_FEN = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

  it('should promote to queen by default (no promotion field)', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const room = server.gameManager.getGame(gameId);
    room.chess.load(PROMO_FEN);

    const moveMade = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'a7', to: 'a8' });
    const data = await moveMade;

    expect(data.san).toBe('a8=Q+');
  });

  it('should promote to queen explicitly', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const room = server.gameManager.getGame(gameId);
    room.chess.load(PROMO_FEN);

    const moveMade = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'a7', to: 'a8', promotion: 'q' });
    const data = await moveMade;

    expect(data.san).toBe('a8=Q+');
  });

  it('should promote to knight', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const room = server.gameManager.getGame(gameId);
    room.chess.load(PROMO_FEN);

    const moveMade = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'a7', to: 'a8', promotion: 'n' });
    const data = await moveMade;

    expect(data.san).toBe('a8=N');
  });

  it('should promote to rook', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const room = server.gameManager.getGame(gameId);
    room.chess.load(PROMO_FEN);

    const moveMade = waitForEvent(clientW, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'a7', to: 'a8', promotion: 'r' });
    const data = await moveMade;

    expect(data.san).toBe('a8=R+');
  });
});
