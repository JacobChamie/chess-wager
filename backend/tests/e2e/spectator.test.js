import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Spectators', () => {
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

  it('should join as spectator when not a player', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'spec-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    const data = await state;

    expect(data.gameId).toBe(gameId);
    expect(data.status).toBe('active');
    expect(data.myColor).toBeNull(); // spectators have no color
  });

  it('should broadcast spectator count update', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'spec-count-1');
    clients.push(spectator);

    const countUpdate = waitForEvent(clientW, 'game:spectators_update');
    spectator.emit('game:join', { gameId });
    const data = await countUpdate;

    expect(data.count).toBe(1);
  });

  it('should broadcast moves to spectators', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'spec-moves-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    const moveMade = waitForEvent(spectator, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await moveMade;

    expect(data.san).toBe('e4');
    expect(data.fen).toBeDefined();
  });

  it('should decrement spectator count when spectator leaves', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'spec-leave-1');
    clients.push(spectator);

    const joined = waitForEvent(clientW, 'game:spectators_update');
    spectator.emit('game:join', { gameId });
    await joined;

    const left = waitForEvent(clientW, 'game:spectators_update');
    spectator.emit('game:leave', { gameId });
    const data = await left;

    expect(data.count).toBe(0);
  });

  it('should broadcast game:over to spectators', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'spec-over-1');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    const gameOver = waitForEvent(spectator, 'game:over');
    clientW.emit('game:resign', { gameId });
    const data = await gameOver;

    expect(data.result).toBe('0-1');
    expect(data.reason).toBe('resign');
  });
});
