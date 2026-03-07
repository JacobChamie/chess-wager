import { createTestServer } from './helpers/createTestServer.js';
import { disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Rematch', () => {
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

  async function endGameByResign(url) {
    const { clientW, clientB, gameId, sessionW, sessionB } = await matchAndJoin(url);
    const over = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await over;
    return { clientW, clientB, gameId, sessionW, sessionB };
  }

  it('should forward rematch offer to opponent', async () => {
    const { clientW, clientB, gameId } = await endGameByResign(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    const data = await offered;

    expect(data.offeredBy).toBe('w');
  });

  it('should start new game with swapped colors on accept', async () => {
    const { clientW, clientB, gameId } = await endGameByResign(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    await offered;

    const rematchW = waitForEvent(clientW, 'game:rematch_start');
    const rematchB = waitForEvent(clientB, 'game:rematch_start');

    clientB.emit('game:respond_rematch', { gameId, accept: true });

    const [dW, dB] = await Promise.all([rematchW, rematchB]);

    // Colors should be swapped
    expect(dW.gameId).toBe(dB.gameId);
    expect(dW.gameId).not.toBe(gameId);
    expect(dW.color).not.toBe(dB.color);
    // Original white should now be black
    expect(dW.color).toBe('b');
    expect(dB.color).toBe('w');
  });

  it('should broadcast decline to both players', async () => {
    const { clientW, clientB, gameId } = await endGameByResign(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    await offered;

    const declinedW = waitForEvent(clientW, 'game:rematch_declined');
    const declinedB = waitForEvent(clientB, 'game:rematch_declined');

    clientB.emit('game:respond_rematch', { gameId, accept: false });

    await Promise.all([declinedW, declinedB]);
  });

  it('should not allow rematch request during active game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Game is still active — rematch should be silently ignored
    clientW.emit('game:rematch', { gameId });

    await new Promise((r) => setTimeout(r, 100));

    const room = server.gameManager.getGame(gameId);
    expect(room.rematchOffer).toBeNull();
  });
});
