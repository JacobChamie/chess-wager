import { createTestServer } from './helpers/createTestServer.js';
import { disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Resign', () => {
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

  it('should end game when white resigns', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const overW = waitForEvent(clientW, 'game:over');
    const overB = waitForEvent(clientB, 'game:over');

    clientW.emit('game:resign', { gameId });

    const [dW, dB] = await Promise.all([overW, overB]);

    expect(dW.result).toBe('0-1');
    expect(dW.reason).toBe('resign');
    expect(dW.winner).toBe('b');
    expect(dB.result).toBe('0-1');
  });

  it('should end game when black resigns', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const overW = waitForEvent(clientW, 'game:over');
    const overB = waitForEvent(clientB, 'game:over');

    clientB.emit('game:resign', { gameId });

    const [dW, dB] = await Promise.all([overW, overB]);

    expect(dW.result).toBe('1-0');
    expect(dW.reason).toBe('resign');
    expect(dW.winner).toBe('w');
    expect(dB.result).toBe('1-0');
  });

  it('should call persistGame after resignation', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const over = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await over;

    expect(server.gameManager.persistGame).toHaveBeenCalledWith(gameId);
  });
});
