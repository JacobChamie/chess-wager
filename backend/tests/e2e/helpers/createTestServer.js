import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { GameManager } from '../../../src/game/GameManager.js';
import { LobbyManager } from '../../../src/lobby/LobbyManager.js';
import { registerHandlers } from '../../../src/socket/handlers.js';
import { createMockPool } from '../../helpers/mockPool.js';

/**
 * Spin up a real Express + Socket.IO server on a random port
 * with mock DB pool (no Postgres needed).
 */
export async function createTestServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  const pool = createMockPool();
  const gameManager = new GameManager(pool);
  const lobbyManager = new LobbyManager(gameManager);

  // Mock persistGame to avoid the 5-minute cleanup setTimeout
  gameManager.persistGame = vi.fn().mockResolvedValue(undefined);

  let onlineCount = 0;

  io.on('connection', (socket) => {
    const sessionId = socket.handshake.auth?.sessionId;
    if (!sessionId) {
      socket.disconnect(true);
      return;
    }

    onlineCount++;
    const activeGames = gameManager.getActiveGames().length;
    io.emit('online:count', { count: onlineCount, games: activeGames });

    registerHandlers(io, socket, sessionId, gameManager, lobbyManager, null, null);

    socket.on('disconnect', () => {
      onlineCount = Math.max(0, onlineCount - 1);
      const activeGames = gameManager.getActiveGames().length;
      io.emit('online:count', { count: onlineCount, games: activeGames });
    });
  });

  await new Promise((resolve) => {
    httpServer.listen(0, () => resolve());
  });

  const port = httpServer.address().port;
  const url = `http://localhost:${port}`;

  return {
    io,
    httpServer,
    gameManager,
    lobbyManager,
    port,
    url,
    close() {
      return new Promise((resolve) => {
        // Destroy all active game rooms (clears intervals/timers)
        for (const [, room] of gameManager.games) {
          room.destroy();
        }
        gameManager.games.clear();
        io.close(() => resolve());
      });
    },
  };
}
