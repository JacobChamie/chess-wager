import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Lobby State', () => {
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

  it('should return lobby state on lobby:get_state', async () => {
    const client = await connectClient(server.url, 'lobby-state-1');
    clients.push(client);

    const stateUpdate = waitForEvent(client, 'lobby:state_update');
    client.emit('lobby:get_state');
    const data = await stateUpdate;

    expect(data).toHaveProperty('openGames');
    expect(data).toHaveProperty('seekers');
    expect(data).toHaveProperty('activeGames');
    expect(Array.isArray(data.openGames)).toBe(true);
    expect(Array.isArray(data.seekers)).toBe(true);
    expect(Array.isArray(data.activeGames)).toBe(true);
  });

  it('should show pending game in openGames', async () => {
    const client = await connectClient(server.url, 'lobby-open-1');
    clients.push(client);

    const created = waitForEvent(client, 'lobby:game_created');
    client.emit('lobby:create_game', {
      timeControl: 300,
      playerName: 'Creator',
      colorPref: 'random',
    });
    await created;

    const stateUpdate = waitForEvent(client, 'lobby:state_update');
    client.emit('lobby:get_state');
    const data = await stateUpdate;

    expect(data.openGames.length).toBeGreaterThanOrEqual(1);
    const myGame = data.openGames.find((g) => g.creatorName === 'Creator');
    expect(myGame).toBeDefined();
    expect(myGame.timeControl).toBe(300);
  });

  it('should show active game in activeGames', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const observer = await connectClient(server.url, 'lobby-active-1');
    clients.push(observer);

    const stateUpdate = waitForEvent(observer, 'lobby:state_update');
    observer.emit('lobby:get_state');
    const data = await stateUpdate;

    expect(data.activeGames.length).toBeGreaterThanOrEqual(1);
    const game = data.activeGames.find((g) => g.gameId === gameId);
    expect(game).toBeDefined();
    expect(game.whiteName).toBeDefined();
    expect(game.blackName).toBeDefined();
  });

  it('should respect colorPref white', async () => {
    const clientA = await connectClient(server.url, 'lobby-white-1');
    const clientB = await connectClient(server.url, 'lobby-white-2');
    clients.push(clientA, clientB);

    const startA = waitForEvent(clientA, 'lobby:game_start');
    const startB = waitForEvent(clientB, 'lobby:game_start');

    clientA.emit('lobby:play', {
      timeControl: 180,
      playerName: 'WhitePref',
      colorPref: 'white',
    });
    clientB.emit('lobby:play', {
      timeControl: 180,
      playerName: 'NoPref',
      colorPref: 'random',
    });

    const [dA, dB] = await Promise.all([startA, startB]);

    // Player who requested white should get white
    expect(dA.color).toBe('w');
    expect(dB.color).toBe('b');
  });

  it('should respect colorPref black', async () => {
    const clientA = await connectClient(server.url, 'lobby-black-1');
    const clientB = await connectClient(server.url, 'lobby-black-2');
    clients.push(clientA, clientB);

    const startA = waitForEvent(clientA, 'lobby:game_start');
    const startB = waitForEvent(clientB, 'lobby:game_start');

    clientA.emit('lobby:play', {
      timeControl: 600,
      playerName: 'BlackPref',
      colorPref: 'black',
    });
    clientB.emit('lobby:play', {
      timeControl: 600,
      playerName: 'NoPref',
      colorPref: 'random',
    });

    const [dA, dB] = await Promise.all([startA, startB]);

    // Player who requested black should get black
    expect(dA.color).toBe('b');
    expect(dB.color).toBe('w');
  });
});
