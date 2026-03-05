import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { pool, initDb } from './config/db.js';
import { GameManager } from './game/GameManager.js';
import { LobbyManager } from './lobby/LobbyManager.js';
import { registerHandlers } from './socket/handlers.js';
import authRoutes from './auth/authRoutes.js';
import leaderboardRoutes from './leaderboard/leaderboardRoutes.js';
import createAdminRoutes from './admin/adminRoutes.js';
import { BotManager } from './admin/botManager.js';
import { verifyToken } from './auth/authService.js';
import { StockfishEngine } from './bot/StockfishEngine.js';
import { BotGameManager } from './bot/BotGameManager.js';
import { initEmailTransporter } from './email/emailService.js';

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:4173'];

const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(cors({ origin: allowedOrigins }));

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

const gameManager = new GameManager(pool);
const lobbyManager = new LobbyManager(gameManager);
const botManager = new BotManager();
const stockfishEngine = new StockfishEngine();
let botGameManager;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/admin', createAdminRoutes(io, botManager, gameManager));

let onlineCount = 0;

io.on('connection', async (socket) => {
  const sessionId = socket.handshake.auth?.sessionId;
  if (!sessionId) {
    socket.disconnect(true);
    return;
  }

  // Extract authenticated user from JWT if provided
  const token = socket.handshake.auth?.token;
  let authUser = null;
  if (token) {
    authUser = verifyToken(token);
  }

  // Check if user is banned
  if (authUser?.id) {
    try {
      const banCheck = await pool.query('SELECT is_banned FROM users WHERE id = $1', [authUser.id]);
      if (banCheck.rows[0]?.is_banned) {
        socket.emit('auth:banned');
        socket.disconnect(true);
        return;
      }
    } catch (err) {
      console.error('Ban check error:', err.message);
    }
  }

  onlineCount++;
  const activeGames = gameManager.getActiveGames().length;
  io.emit('online:count', { count: onlineCount, games: activeGames });

  console.log(`Connected: socket=${socket.id} session=${sessionId}${authUser ? ` user=${authUser.username}` : ''}`);
  registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser, botGameManager);

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    const activeGames = gameManager.getActiveGames().length;
    io.emit('online:count', { count: onlineCount, games: activeGames });
  });
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initDb();
  initEmailTransporter();

  try {
    await stockfishEngine.init();
    botGameManager = new BotGameManager(gameManager, stockfishEngine);
    console.log('Stockfish engine ready for bot games');
  } catch (err) {
    console.error('Failed to initialize Stockfish:', err.message);
    console.warn('Bot games will be unavailable');
  }

  httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
