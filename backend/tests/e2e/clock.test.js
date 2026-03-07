import { createTestServer } from './helpers/createTestServer.js';
import { disconnectAll, waitForEvent, collectEvents } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Clock', () => {
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

  it('should broadcast clock updates periodically', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: 30,
    });
    clients.push(clientW, clientB);

    // Collect at least 2 clock updates (~2 seconds)
    const updates = await collectEvents(clientW, 'game:clock_update', 2, 5000);

    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0]).toHaveProperty('whiteTime');
    expect(updates[0]).toHaveProperty('blackTime');
    // White is active, so whiteTime should decrease
    expect(updates[1].whiteTime).toBeLessThan(updates[0].whiteTime);
  });

  it('should switch active clock after a move', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: 30,
    });
    clients.push(clientW, clientB);

    // Make a move (white → black's turn)
    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const moveData = await moveMade;

    // After white's move, whiteTime should be close to 30s, blackTime starts running
    expect(moveData.whiteTime).toBeLessThanOrEqual(30000);
    expect(moveData.blackTime).toBeLessThanOrEqual(30000);

    // Wait for a clock update — black should be ticking now
    const update = await waitForEvent(clientW, 'game:clock_update', 3000);
    // blackTime should be decreasing
    expect(update.blackTime).toBeLessThan(30000);
  });

  it('should add increment after a move', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: { time: 10, increment: 5 },
    });
    clients.push(clientW, clientB);

    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await moveMade;

    // White started with 10s, moved quickly, got +5s increment
    // Should be close to 15s (minus small elapsed time)
    expect(data.whiteTime).toBeGreaterThan(10000);
    expect(data.whiteTime).toBeLessThanOrEqual(15000);
  });

  it('should end game on timeout', async () => {
    // Very short time control: 1 second
    const { clientW, clientB, gameId } = await matchAndJoin(server.url, {
      timeControl: 1,
    });
    clients.push(clientW, clientB);

    // Don't make any moves — white should flag after ~1 second
    const gameOver = waitForEvent(clientW, 'game:over', 5000);
    const data = await gameOver;

    expect(data.reason).toBe('timeout');
    expect(data.winner).toBe('b'); // White flagged
    expect(data.result).toBe('0-1');
  });
});
