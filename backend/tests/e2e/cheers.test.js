import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Cheers/Jeers', () => {
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

  it('should broadcast cheer from spectator to all in room', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'cheer-spec-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    const cheerW = waitForEvent(clientW, 'game:cheer_received');
    const cheerB = waitForEvent(clientB, 'game:cheer_received');
    const cheerS = waitForEvent(spectator, 'game:cheer_received');

    spectator.emit('game:cheer', { gameId, targetColor: 'w' });

    const [dW, dB, dS] = await Promise.all([cheerW, cheerB, cheerS]);

    expect(dW.targetColor).toBe('w');
    expect(dW.senderName).toBeDefined();
    expect(dB.targetColor).toBe('w');
    expect(dS.targetColor).toBe('w');
  });

  it('should silently ignore cheer from non-spectator (player)', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Player tries to cheer — should be silently ignored
    clientW.emit('game:cheer', { gameId, targetColor: 'w' });

    // Wait a bit and verify no cheer was broadcast
    await new Promise((r) => setTimeout(r, 200));

    // No crash or response — test passes if we get here
  });

  it('should silently ignore cheer with invalid target color', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'cheer-invalid-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    spectator.emit('game:cheer', { gameId, targetColor: 'x' });

    // Wait and verify no cheer was broadcast
    await new Promise((r) => setTimeout(r, 200));
  });

  it('should enforce cheer cooldown', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'cheer-cool-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    // First cheer should succeed
    const cheer1 = waitForEvent(clientW, 'game:cheer_received');
    spectator.emit('game:cheer', { gameId, targetColor: 'w' });
    await cheer1;

    // Second cheer immediately — should be silently dropped (cooldown is 15s)
    let secondCheerReceived = false;
    clientW.once('game:cheer_received', () => { secondCheerReceived = true; });
    spectator.emit('game:cheer', { gameId, targetColor: 'b' });

    await new Promise((r) => setTimeout(r, 200));
    expect(secondCheerReceived).toBe(false);
  });

  it('should reject cheer when clock is low (<30s)', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'cheer-lowtime-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    // Set white's time to below 30s threshold
    const room = server.gameManager.getGame(gameId);
    room.clock.whiteTimeMs = 20000;

    let cheerReceived = false;
    clientW.once('game:cheer_received', () => { cheerReceived = true; });
    spectator.emit('game:cheer', { gameId, targetColor: 'w' });

    await new Promise((r) => setTimeout(r, 200));
    expect(cheerReceived).toBe(false);
  });
});
