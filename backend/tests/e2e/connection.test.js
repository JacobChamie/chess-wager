import { io as ioc } from 'socket.io-client';
import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';

describe('E2E: Connection', () => {
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

  it('should accept a connection with a sessionId', async () => {
    const client = await connectClient(server.url, 'conn-test-1');
    clients.push(client);
    expect(client.connected).toBe(true);
  });

  it('should disconnect a client without a sessionId', async () => {
    const socket = ioc(server.url, {
      auth: { sessionId: '' },
      forceNew: true,
      transports: ['websocket'],
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Socket was not disconnected')), 3000);
        socket.on('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } finally {
      socket.disconnect();
    }
  });

  it('should support multiple concurrent clients', async () => {
    const c1 = await connectClient(server.url, 'multi-1');
    const c2 = await connectClient(server.url, 'multi-2');
    const c3 = await connectClient(server.url, 'multi-3');
    clients.push(c1, c2, c3);
    expect(c1.connected).toBe(true);
    expect(c2.connected).toBe(true);
    expect(c3.connected).toBe(true);
  });

  it('should broadcast online:count on connect', async () => {
    const c1 = await connectClient(server.url, 'count-1');
    clients.push(c1);

    // Listen for online:count >= 2 (skip c1's own connection event)
    const countPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for count >= 2')), 5000);
      const handler = (data) => {
        if (data.count >= 2) {
          clearTimeout(timer);
          c1.off('online:count', handler);
          resolve(data);
        }
      };
      c1.on('online:count', handler);
    });

    const c2 = await connectClient(server.url, 'count-2');
    clients.push(c2);
    const data = await countPromise;
    expect(data.count).toBeGreaterThanOrEqual(2);
    expect(data).toHaveProperty('games');
  });
});
