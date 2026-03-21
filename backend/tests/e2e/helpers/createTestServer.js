import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import { GameManager } from '../../../src/game/GameManager.js';
import { LobbyManager } from '../../../src/lobby/LobbyManager.js';
import { BotGameManager } from '../../../src/bot/BotGameManager.js';
import { registerHandlers } from '../../../src/socket/handlers.js';
import { createMockPool } from '../../helpers/mockPool.js';
import { WagerService } from '../../../src/wager/WagerService.js';
import { MockFairPlayService } from '../../helpers/mockFairPlayService.js';

/**
 * Mock Stockfish engine that returns the first legal move.
 * Deterministic — no real Stockfish process needed.
 */
class MockStockfishEngine {
  async getBestMove(fen) {
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;
    const pick = moves[0];
    return { from: pick.from, to: pick.to, promotion: pick.promotion };
  }
  destroy() {}
}

/**
 * Spin up a real Express + Socket.IO server on a random port
 * with mock DB pool (no Postgres needed).
 *
 * @param {Object} opts
 * @param {boolean} opts.enableBots — create a BotGameManager with mock engine
 */
export async function createTestServer(opts = {}) {
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

  let botGameManager = null;
  if (opts.enableBots) {
    const engine = new MockStockfishEngine();
    botGameManager = new BotGameManager(gameManager, engine);
  }

  // WagerService — mock lockWager/settleWager for E2E tests (no real DB)
  let wagerService = null;
  if (opts.enableWagers) {
    wagerService = new WagerService(pool);
    // Override with mocks that always succeed
    wagerService.lockWager = vi.fn().mockResolvedValue({ success: true });
    wagerService.settleWager = vi.fn().mockResolvedValue(undefined);
  }

  let fairPlayService = null;
  if (opts.enableFairPlay) {
    fairPlayService = new MockFairPlayService();
  }

  let onlineCount = 0;

  io.on('connection', (socket) => {
    const sessionId = socket.handshake.auth?.sessionId;
    if (!sessionId) {
      socket.disconnect(true);
      return;
    }

    // Allow tests to pass authUser via socket handshake
    const authUser = socket.handshake.auth?.authUser || null;

    onlineCount++;
    const activeGames = gameManager.getActiveGames().length;
    io.emit('online:count', { count: onlineCount, games: activeGames });

    registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser, botGameManager, wagerService, pool, fairPlayService);

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
    botGameManager,
    wagerService,
    fairPlayService,
    pool,
    port,
    url,
    close() {
      return new Promise((resolve) => {
        if (botGameManager) botGameManager.destroyAll();
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
