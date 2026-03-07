import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';

describe('E2E: Matchmaking', () => {
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

  it('should queue a single player', async () => {
    const c1 = await connectClient(server.url, 'mm-queue-1');
    clients.push(c1);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    await queued;
  });

  it('should match two players with the same time control', async () => {
    const c1 = await connectClient(server.url, 'mm-match-1');
    const c2 = await connectClient(server.url, 'mm-match-2');
    clients.push(c1, c2);

    const start1 = waitForEvent(c1, 'lobby:game_start');
    const start2 = waitForEvent(c2, 'lobby:game_start');

    c1.emit('lobby:play', { timeControl: 600, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 600, playerName: 'Bob' });

    const [d1, d2] = await Promise.all([start1, start2]);

    expect(d1.gameId).toBe(d2.gameId);
    expect(['w', 'b']).toContain(d1.color);
    expect(d1.color).not.toBe(d2.color);
    expect(d1.fen).toBeDefined();
    expect(d1.timeControl).toBeDefined();
  });

  it('should not match players with different time controls', async () => {
    const c1 = await connectClient(server.url, 'mm-diff-1');
    const c2 = await connectClient(server.url, 'mm-diff-2');
    clients.push(c1, c2);

    const queued1 = waitForEvent(c1, 'lobby:queued');
    const queued2 = waitForEvent(c2, 'lobby:queued');

    c1.emit('lobby:play', { timeControl: 180, playerName: 'Alice' });
    c2.emit('lobby:play', { timeControl: 600, playerName: 'Bob' });

    await Promise.all([queued1, queued2]);
    // Neither should have received lobby:game_start
  });

  it('should allow a player to cancel their queue', async () => {
    const c1 = await connectClient(server.url, 'mm-cancel-1');
    const c2 = await connectClient(server.url, 'mm-cancel-2');
    clients.push(c1, c2);

    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    await queued;

    c1.emit('lobby:cancel_play');

    // Now c2 queues with same TC — should NOT match
    const queued2 = waitForEvent(c2, 'lobby:queued');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });
    await queued2;
  });

  it('should broadcast lobby state after matchmaking', async () => {
    const c1 = await connectClient(server.url, 'mm-state-1');
    const c2 = await connectClient(server.url, 'mm-state-2');
    clients.push(c1, c2);

    const stateUpdate = waitForEvent(c1, 'lobby:state_update');

    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });

    const data = await stateUpdate;
    expect(data).toHaveProperty('openGames');
    expect(data).toHaveProperty('seekers');
    expect(data).toHaveProperty('activeGames');
  });
});
