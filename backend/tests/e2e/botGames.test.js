import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';

describe('E2E: Bot Games', () => {
  let server;
  let clients = [];

  beforeAll(async () => {
    server = await createTestServer({ enableBots: true });
  });

  afterEach(async () => {
    await disconnectAll(clients);
    clients = [];
  });

  afterAll(async () => {
    await server.close();
  });

  it('should return bot personalities', async () => {
    const client = await connectClient(server.url, 'bot-pers-1');
    clients.push(client);

    const personalities = waitForEvent(client, 'bot:personalities');
    client.emit('bot:get_personalities');
    const data = await personalities;

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(6);
    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('rating');
  });

  it('should start a bot game', async () => {
    const client = await connectClient(server.url, 'bot-start-1');
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'beginner',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const data = await gameStart;

    expect(data.gameId).toBeDefined();
    expect(data.color).toBe('w');
    expect(data.opponentName).toBe('Woody');
    expect(data.personality.id).toBe('beginner');
    expect(data.fen).toBeDefined();
  });

  it('should receive bot move after human moves', async () => {
    const client = await connectClient(server.url, 'bot-move-1');
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'beginner',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const startData = await gameStart;
    const gameId = startData.gameId;

    // Join the game room to receive broadcasts
    const state = waitForEvent(client, 'game:state');
    client.emit('game:join', { gameId });
    await state;

    // Human plays e4, then wait for bot's response move
    // We need to collect 2 game:move_made events: our own + bot's
    const humanMove = waitForEvent(client, 'game:move_made');
    client.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await humanMove;

    // Bot should respond with a move (mock engine returns first legal move)
    const botMove = waitForEvent(client, 'game:move_made', 10000);
    const botData = await botMove;

    expect(botData.san).toBeDefined();
    expect(botData.turn).toBe('w'); // After bot (black) moves, it's white's turn
  });

  it('should include bot info in game state', async () => {
    const client = await connectClient(server.url, 'bot-state-1');
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'easy',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const startData = await gameStart;

    const state = waitForEvent(client, 'game:state');
    client.emit('game:join', { gameId: startData.gameId });
    const stateData = await state;

    expect(stateData.isBotGame).toBe(true);
    expect(stateData.botPersonality).toBeDefined();
    expect(stateData.botPersonality.id).toBe('easy');
    expect(stateData.botPersonality.name).toBe('Chip');
  });

  it('should auto-decline draw offers in bot games', async () => {
    const client = await connectClient(server.url, 'bot-draw-1');
    clients.push(client);

    const gameStart = waitForEvent(client, 'bot:game_start');
    client.emit('bot:start_game', {
      personalityId: 'beginner',
      timeControl: { time: 300, increment: 0 },
      playerName: 'Tester',
      colorPref: 'white',
    });
    const startData = await gameStart;
    const gameId = startData.gameId;

    // Join room
    const state = waitForEvent(client, 'game:state');
    client.emit('game:join', { gameId });
    await state;

    // Offer draw — should be auto-declined
    const declined = waitForEvent(client, 'game:draw_declined');
    client.emit('game:offer_draw', { gameId });
    const data = await declined;

    expect(data).toBeDefined();
  });
});
