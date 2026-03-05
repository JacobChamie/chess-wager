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
import { verifyToken } from './auth/authService.js';

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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);

io.on('connection', (socket) => {
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

  console.log(`Connected: socket=${socket.id} session=${sessionId}${authUser ? ` user=${authUser.username}` : ''}`);
  registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser);
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initDb();
  httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
