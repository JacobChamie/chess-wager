import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';

describe('E2E: Create & Join Game', () => {
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

  it('should create a pending game', async () => {
    const c1 = await connectClient(server.url, 'cj-create-1');
    clients.push(c1);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'Alice' });
    const data = await created;

    expect(data.gameId).toBeDefined();
    expect(typeof data.gameId).toBe('string');
  });

  it('should allow another player to join', async () => {
    const c1 = await connectClient(server.url, 'cj-join-1');
    const c2 = await connectClient(server.url, 'cj-join-2');
    clients.push(c1, c2);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'Alice' });
    const { gameId } = await created;

    const start1 = waitForEvent(c1, 'lobby:game_start');
    const start2 = waitForEvent(c2, 'lobby:game_start');

    c2.emit('lobby:join_game', { gameId, playerName: 'Bob' });

    const [d1, d2] = await Promise.all([start1, start2]);

    expect(d1.gameId).toBe(gameId);
    expect(d2.gameId).toBe(gameId);
    expect(d1.color).not.toBe(d2.color);
  });

  it('should not allow joining own game', async () => {
    const c1 = await connectClient(server.url, 'cj-own-1');
    clients.push(c1);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'Alice' });
    const { gameId } = await created;

    const error = waitForEvent(c1, 'lobby:error');
    c1.emit('lobby:join_game', { gameId, playerName: 'Alice' });
    const data = await error;

    expect(data.message).toMatch(/own game/i);
  });

  it('should error when joining a nonexistent game', async () => {
    const c1 = await connectClient(server.url, 'cj-noexist-1');
    clients.push(c1);

    const error = waitForEvent(c1, 'lobby:error');
    c1.emit('lobby:join_game', { gameId: 'fake-game-999', playerName: 'Alice' });
    const data = await error;

    expect(data.message).toMatch(/not found/i);
  });

  it('should allow creator to cancel a pending game', async () => {
    const c1 = await connectClient(server.url, 'cj-cancel-1');
    const c2 = await connectClient(server.url, 'cj-cancel-2');
    clients.push(c1, c2);

    const created = waitForEvent(c1, 'lobby:game_created');
    c1.emit('lobby:create_game', { timeControl: 300, playerName: 'Alice' });
    const { gameId } = await created;

    c1.emit('lobby:cancel_game');

    // Small delay for cancel to process
    await new Promise((r) => setTimeout(r, 100));

    const error = waitForEvent(c2, 'lobby:error');
    c2.emit('lobby:join_game', { gameId, playerName: 'Bob' });
    const data = await error;

    expect(data.message).toMatch(/not found/i);
  });
});
