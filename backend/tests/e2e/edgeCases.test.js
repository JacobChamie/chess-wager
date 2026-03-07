import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Edge Cases', () => {
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

  it('should truncate chat messages at 500 characters', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const longMsg = 'A'.repeat(600);
    const msg = waitForEvent(clientB, 'chat:message');
    clientW.emit('chat:send', { gameId, message: longMsg });
    const data = await msg;

    expect(data.message.length).toBe(500);
  });

  it('should ignore empty chat messages', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // Send empty message
    clientW.emit('chat:send', { gameId, message: '' });
    // Send whitespace-only message
    clientW.emit('chat:send', { gameId, message: '   ' });

    await new Promise((r) => setTimeout(r, 200));

    const room = server.gameManager.getGame(gameId);
    expect(room.chatMessages).toHaveLength(0);
  });

  it('should reject a move on a completed game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // End the game by resignation
    const over = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await over;

    // Try to make a move — should get invalid_move
    const invalid = waitForEvent(clientW, 'game:invalid_move');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    const data = await invalid;

    expect(data.message).toMatch(/not active/i);
  });

  it('should return completed state when joining a finished game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const over = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await over;

    // Third client joins — should see completed state
    const observer = await connectClient(server.url, 'edge-join-completed-1');
    clients.push(observer);

    const state = waitForEvent(observer, 'game:state');
    observer.emit('game:join', { gameId });
    const data = await state;

    expect(data.status).toBe('completed');
    expect(data.result).toBe('0-1');
    expect(data.reason).toBe('resign');
  });

  it('should ignore draw offer on a completed game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const over = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await over;

    // Offer draw on completed game — should be silently ignored
    clientB.emit('game:offer_draw', { gameId });

    await new Promise((r) => setTimeout(r, 200));

    const room = server.gameManager.getGame(gameId);
    expect(room.drawOffer).toBeNull();
  });

  it('should allow playing moves in a rematch game', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    // End game
    const over = waitForEvent(clientW, 'game:over');
    clientW.emit('game:resign', { gameId });
    await over;

    // Offer and accept rematch
    const offered = waitForEvent(clientB, 'game:rematch_offered');
    clientW.emit('game:rematch', { gameId });
    await offered;

    const rematchW = waitForEvent(clientW, 'game:rematch_start');
    const rematchB = waitForEvent(clientB, 'game:rematch_start');
    clientB.emit('game:respond_rematch', { gameId, accept: true });
    const [dW, dB] = await Promise.all([rematchW, rematchB]);

    const newGameId = dW.gameId;
    expect(newGameId).not.toBe(gameId);

    // Determine who is white in the new game (colors are swapped)
    const newWhiteClient = dW.color === 'w' ? clientW : clientB;

    // Make a move in the new game — should succeed
    const moveMade = waitForEvent(newWhiteClient, 'game:move_made');
    newWhiteClient.emit('game:move', { gameId: newGameId, from: 'e2', to: 'e4' });
    const moveData = await moveMade;

    expect(moveData.san).toBe('e4');
    expect(moveData.turn).toBe('b');
  });
});
