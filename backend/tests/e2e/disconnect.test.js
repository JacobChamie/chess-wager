import { createTestServer } from './helpers/createTestServer.js';
import { connectClient, disconnectAll, disconnectClient, waitForEvent } from './helpers/createTestClient.js';
import { matchAndJoin } from './helpers/matchAndJoin.js';

describe('E2E: Disconnect & Reconnect', () => {
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

  it('should notify opponent on disconnect', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientB);
    // clientW will be manually disconnected

    const disconnected = waitForEvent(clientB, 'game:opponent_disconnected');
    await disconnectClient(clientW);
    const data = await disconnected;

    expect(data.timeout).toBe(60);
  });

  it('should cancel forfeit timer on reconnect', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url);
    clients.push(clientB);

    const disconnected = waitForEvent(clientB, 'game:opponent_disconnected');
    await disconnectClient(clientW);
    await disconnected;

    // Reconnect with same sessionId
    const clientW2 = await connectClient(server.url, sessionW);
    clients.push(clientW2);

    const reconnected = waitForEvent(clientB, 'game:opponent_reconnected');
    clientW2.emit('game:join', { gameId });
    await reconnected;

    // Verify the disconnect timer was cleared
    const room = server.gameManager.getGame(gameId);
    expect(room.disconnectTimers[sessionW]).toBeUndefined();
  });

  it('should send full game state to reconnected player', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url);
    clients.push(clientB);

    // Make a move first
    const moveMade = waitForEvent(clientB, 'game:move_made');
    clientW.emit('game:move', { gameId, from: 'e2', to: 'e4' });
    await moveMade;

    await disconnectClient(clientW);

    // Reconnect
    const clientW2 = await connectClient(server.url, sessionW);
    clients.push(clientW2);

    const state = waitForEvent(clientW2, 'game:state');
    clientW2.emit('game:join', { gameId });
    const data = await state;

    expect(data.gameId).toBe(gameId);
    expect(data.status).toBe('active');
    expect(data.myColor).toBe('w');
    // FEN should reflect the e4 move (not the starting position)
    expect(data.fen).not.toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(data.moves).toHaveLength(1);
  });

  it('should report the active game for a player session', async () => {
    const { clientW, clientB, gameId } = await matchAndJoin(server.url);
    clients.push(clientW, clientB);

    const activeGame = waitForEvent(clientW, 'game:active');
    clientW.emit('game:get_active');
    const data = await activeGame;

    expect(data.gameId).toBe(gameId);
    expect(data.color).toBe('w');
    expect(data.opponentName).toBeTruthy();
  });

  it('should forfeit game after disconnect timeout', async () => {
    const { clientW, clientB, gameId, sessionW } = await matchAndJoin(server.url);
    clients.push(clientB);

    const room = server.gameManager.getGame(gameId);

    // Patch handleDisconnect to use a very short timeout for this test
    room.handleDisconnect = function (sessionId) {
      if (this.status !== 'active') return;
      this.disconnectTimers[sessionId] = setTimeout(() => {
        const color = this.getPlayerColor(sessionId);
        if (color && this.status === 'active') {
          const winnerColor = color === 'w' ? 'b' : 'w';
          const result = this._endGame(
            winnerColor === 'w' ? '1-0' : '0-1',
            'abandonment',
            winnerColor
          );
          this.onGameOver?.(result);
        }
      }, 200); // 200ms instead of 60s
    };

    const gameOver = waitForEvent(clientB, 'game:over');
    await disconnectClient(clientW);

    const data = await gameOver;
    expect(data.result).toBe('0-1');
    expect(data.reason).toBe('abandonment');
    expect(data.winner).toBe('b');
  });

  it('should remove disconnected player from matchmaking queue', async () => {
    const c1 = await connectClient(server.url, 'disc-queue-1');
    const c2 = await connectClient(server.url, 'disc-queue-2');
    clients.push(c2);

    // Queue c1
    const queued = waitForEvent(c1, 'lobby:queued');
    c1.emit('lobby:play', { timeControl: 300, playerName: 'Alice' });
    await queued;

    // Disconnect c1
    await disconnectClient(c1);

    // c2 queues with same TC — should NOT match (c1 was removed)
    const queued2 = waitForEvent(c2, 'lobby:queued');
    c2.emit('lobby:play', { timeControl: 300, playerName: 'Bob' });
    await queued2;
  });
});
