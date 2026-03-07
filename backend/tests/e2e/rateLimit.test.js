import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll } from './helpers/createTestClient.js';

describe('E2E: Rate Limiting', () => {
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

  /**
   * Collect events with a fixed timeout (resolves with whatever was collected).
   */
  function collectWithTimeout(socket, event, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const results = [];
      const handler = (data) => results.push(data);
      socket.on(event, handler);
      setTimeout(() => {
        socket.off(event, handler);
        resolve(results);
      }, timeoutMs);
    });
  }

  it('should process events under the rate limit', async () => {
    const client = await connectClient(server.url, 'rate-under-1');
    clients.push(client);

    const collecting = collectWithTimeout(client, 'lobby:state_update', 2000);

    // Send 10 events (under the 15/sec limit)
    for (let i = 0; i < 10; i++) {
      client.emit('lobby:get_state');
    }

    const results = await collecting;
    expect(results.length).toBe(10);
  });

  it('should drop events over the rate limit', async () => {
    const client = await connectClient(server.url, 'rate-over-1');
    clients.push(client);

    const collecting = collectWithTimeout(client, 'lobby:state_update', 2000);

    // Send 25 events in a burst (well over the 15/sec limit)
    for (let i = 0; i < 25; i++) {
      client.emit('lobby:get_state');
    }

    const results = await collecting;
    // Should get at most 15 responses (the rate limit)
    expect(results.length).toBeLessThanOrEqual(15);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should enforce rate limits per socket (not globally)', async () => {
    const clientA = await connectClient(server.url, 'rate-iso-a');
    const clientB = await connectClient(server.url, 'rate-iso-b');
    clients.push(clientA, clientB);

    // Exhaust A's rate limit
    for (let i = 0; i < 20; i++) {
      clientA.emit('lobby:get_state');
    }

    // Small delay to ensure A's events are processed
    await new Promise((r) => setTimeout(r, 100));

    // B should still work fine
    const collecting = collectWithTimeout(clientB, 'lobby:state_update', 1500);
    for (let i = 0; i < 5; i++) {
      clientB.emit('lobby:get_state');
    }

    const results = await collecting;
    expect(results.length).toBe(5);
  });
});
