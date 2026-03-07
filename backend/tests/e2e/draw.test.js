import { createTestServer } from './helpers/createTestServer.js';
import { disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Draw', () => {
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

  it('should forward draw offer to opponent', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    const data = await offered;

    expect(data.offeredBy).toBe('w');
  });

  it('should end game as draw when accepted', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    await offered;

    const overW = waitForEvent(clientW, 'game:over');
    const overB = waitForEvent(clientB, 'game:over');

    clientB.emit('game:respond_draw', { gameId, accept: true });

    const [dW, dB] = await Promise.all([overW, overB]);

    expect(dW.result).toBe('1/2-1/2');
    expect(dW.reason).toBe('draw_agreement');
    expect(dW.winner).toBeNull();
    expect(dB.result).toBe('1/2-1/2');
  });

  it('should clear offer when declined', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    await offered;

    const declined = waitForEvent(clientW, 'game:draw_declined');
    clientB.emit('game:respond_draw', { gameId, accept: false });
    await declined;

    // After decline, white should be able to offer again
    const offered2 = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    const data = await offered2;
    expect(data.offeredBy).toBe('w');
  });

  it('should clear draw offer when a move is made', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    await offered;

    // White makes a move — draw offer should be cleared
    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    // Verify draw offer cleared by checking room state
    const room = server.gameManager.getGame(gameId);
    expect(room.drawOffer).toBeNull();
  });

  it('should not allow a double draw offer', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const offered = waitForEvent(clientB, 'game:draw_offered');
    clientW.emit('game:offer_draw', { gameId });
    await offered;

    // White tries to offer again — should be silently ignored
    clientW.emit('game:offer_draw', { gameId });

    // Small delay to ensure the second offer would have been processed
    await new Promise((r) => setTimeout(r, 100));

    const room = server.gameManager.getGame(gameId);
    expect(room.drawOffer).toBe('w');
  });
});
