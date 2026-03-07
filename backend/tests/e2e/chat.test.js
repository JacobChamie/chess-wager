import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Chat', () => {
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

  it('should broadcast player chat to both players', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const msgW = waitForEvent(clientW, 'chat:message');
    const msgB = waitForEvent(clientB, 'chat:message');

    clientW.emit('chat:send', { gameId, message: 'Hello!' });

    const [dW, dB] = await Promise.all([msgW, msgB]);

    expect(dW.message).toBe('Hello!');
    expect(dW.senderName).toBeDefined();
    expect(dB.message).toBe('Hello!');
  });

  it('should sanitize HTML in chat messages', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const msg = waitForEvent(clientB, 'chat:message');
    clientW.emit('chat:send', { gameId, message: '<script>alert("xss")</script>' });
    const data = await msg;

    expect(data.message).not.toContain('<script>');
    expect(data.message).toContain('&lt;script&gt;');
  });

  it('should not allow spectators to send player chat', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'chat-spec-1');
    clients.push(spectator);

    // Join as spectator
    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    // Spectator tries player chat — should be silently ignored
    spectator.emit('chat:send', { gameId, message: 'I am spectator' });

    // Wait a bit and verify no chat message was broadcast
    await new Promise((r) => setTimeout(r, 200));
    const room = server.gameManager.getGame(gameId);
    const specMessages = room.chatMessages.filter((m) => m.message === 'I am spectator');
    expect(specMessages).toHaveLength(0);
  });

  it('should allow spectators to send spectator chat', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const spectator = await connectClient(server.url, 'chat-spec-2');
    clients.push(spectator);

    const state = waitForEvent(spectator, 'game:state');
    spectator.emit('game:join', { gameId });
    await state;

    const specMsg = waitForEvent(clientW, 'spectator:chat:message');
    spectator.emit('spectator:chat:send', { gameId, message: 'Go white!' });
    const data = await specMsg;

    expect(data.message).toBe('Go white!');
    expect(data.senderName).toBeDefined();
  });

  it('should not allow players to send spectator chat', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Player tries spectator chat — should be silently ignored
    clientW.emit('spectator:chat:send', { gameId, message: 'Fake spectator' });

    await new Promise((r) => setTimeout(r, 200));
    const room = server.gameManager.getGame(gameId);
    expect(room.spectatorChatMessages).toHaveLength(0);
  });
});
