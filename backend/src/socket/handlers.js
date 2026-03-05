import { createRateLimiter } from '../utils/rateLimiter.js';

const rateLimiter = createRateLimiter(15, 1000); // 15 events per second

// Cheer cooldowns
const cheerCooldowns = new Map(); // sessionId -> timestamp
const CHEER_COOLDOWN_MS = 15000;
const LOW_TIME_MS = 30000;

function broadcastLobbyState(io, lobbyManager) {
  io.emit('lobby:state_update', {
    openGames: lobbyManager.getOpenGames(),
    seekers: lobbyManager.getSeekers(),
    activeGames: lobbyManager.getActiveGames(),
  });
}

export function registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser) {
  const checkRate = () => {
    if (!rateLimiter(socket.id)) {
      console.warn(`[RateLimit] Socket ${socket.id} exceeded rate limit`);
      return false;
    }
    return true;
  };

  // --- Lobby Events ---

  socket.on('lobby:get_state', () => {
    if (!checkRate()) return;
    socket.emit('lobby:state_update', {
      openGames: lobbyManager.getOpenGames(),
      seekers: lobbyManager.getSeekers(),
      activeGames: lobbyManager.getActiveGames(),
    });
  });

  socket.on('lobby:play', ({ timeControl, playerName, colorPref, rating }) => {
    if (!checkRate()) return;
    const match = lobbyManager.addToQueue(
      sessionId,
      socket.id,
      playerName || 'Anonymous',
      timeControl || 300,
      authUser?.id || null,
      rating || null,
      colorPref || 'random'
    );

    if (match) {
      // Match found — notify both players
      const { room, player1, player2 } = match;
      const gameId = room.gameId;

      _emitGameStart(io, room, player1, player2);

      // Set up game callbacks
      _setupGameCallbacks(io, room, gameManager, lobbyManager);
    } else {
      socket.emit('lobby:queued', {});
    }
    broadcastLobbyState(io, lobbyManager);
  });

  socket.on('lobby:cancel_play', () => {
    if (!checkRate()) return;
    lobbyManager.removeFromQueue(sessionId);
    broadcastLobbyState(io, lobbyManager);
  });

  socket.on('lobby:create_game', ({ timeControl, playerName, colorPref, rating }) => {
    if (!checkRate()) return;
    const gameId = lobbyManager.createPendingGame(
      sessionId,
      socket.id,
      playerName || 'Anonymous',
      timeControl || 300,
      authUser?.id || null,
      rating || null,
      colorPref || 'random'
    );
    socket.emit('lobby:game_created', { gameId });
    broadcastLobbyState(io, lobbyManager);
  });

  socket.on('lobby:cancel_game', () => {
    if (!checkRate()) return;
    lobbyManager.removePendingBySession(sessionId);
    broadcastLobbyState(io, lobbyManager);
  });

  socket.on('lobby:join_game', ({ gameId, playerName }) => {
    if (!checkRate()) return;
    const result = lobbyManager.joinPendingGame(
      gameId,
      sessionId,
      socket.id,
      playerName || 'Anonymous',
      authUser?.id || null
    );

    if (result.error) {
      socket.emit('lobby:error', { message: result.error });
      return;
    }

    const { room, creator, joiner } = result;

    _emitGameStart(io, room, creator, joiner);
    _setupGameCallbacks(io, room, gameManager, lobbyManager);
    broadcastLobbyState(io, lobbyManager);
  });

  // --- Game Events ---

  socket.on('game:join', ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) {
      socket.emit('lobby:error', { message: 'Game not found' });
      return;
    }

    // Try socketId first, then sessionId (for reconnection with new socket)
    let color = room.getPlayerColor(socket.id);
    if (!color) {
      color = room.getPlayerColor(sessionId);
      if (color) {
        // Reconnecting — update the stored socketId
        room.updateSocketId(sessionId, socket.id);
      }
    }

    if (!color) {
      // Auto-join as spectator
      const playerName = authUser?.username || 'Spectator';
      room.addSpectator(sessionId, socket.id, playerName);
      socket.join(gameId);
      socket.emit('game:state', room.getFullState(sessionId));
      io.to(gameId).emit('game:spectators_update', { count: room.getSpectatorCount() });
      return;
    }

    room.handleReconnect(sessionId, socket.id);
    socket.join(gameId);

    socket.emit('game:state', room.getFullState(socket.id));

    const opponent = room.getOpponentOf(socket.id);
    if (opponent) {
      io.to(opponent.socketId).emit('game:opponent_reconnected', {});
    }
  });

  socket.on('game:move', ({ gameId, from, to, promotion }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.tryMove(socket.id, { from, to, promotion });

    if (!result.valid) {
      socket.emit('game:invalid_move', { message: result.message });
      return;
    }

    io.to(gameId).emit('game:move_made', {
      san: result.san,
      from: result.from,
      to: result.to,
      fen: result.fen,
      turn: result.turn,
      whiteTime: result.whiteTime,
      blackTime: result.blackTime,
      moves: result.moves,
    });

    if (result.gameOver) {
      io.to(gameId).emit('game:over', result.gameOver);
      gameManager.persistGame(gameId);
      broadcastLobbyState(io, lobbyManager);
    }
  });

  socket.on('game:resign', ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.resign(socket.id);
    if (result) {
      io.to(gameId).emit('game:over', result);
      gameManager.persistGame(gameId);
      broadcastLobbyState(io, lobbyManager);
    }
  });

  socket.on('game:offer_draw', ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.offerDraw(socket.id);
    if (result) {
      const opponent = room.getOpponentOf(socket.id);
      if (opponent) {
        io.to(opponent.socketId).emit('game:draw_offered', {
          offeredBy: result.offeredBy,
        });
      }
    }
  });

  socket.on('game:respond_draw', ({ gameId, accept }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.respondDraw(socket.id, accept);
    if (!result) return;

    if (result.result) {
      io.to(gameId).emit('game:over', result);
      gameManager.persistGame(gameId);
      broadcastLobbyState(io, lobbyManager);
    } else if (result.declined) {
      io.to(gameId).emit('game:draw_declined', {});
    }
  });

  socket.on('game:rematch', ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.requestRematch(socket.id);
    if (result) {
      const opponent = room.getOpponentOf(socket.id);
      if (opponent) {
        io.to(opponent.socketId).emit('game:rematch_offered', {
          offeredBy: result.offeredBy,
        });
      }
    }
  });

  socket.on('game:respond_rematch', ({ gameId, accept }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.respondRematch(socket.id, accept);
    if (!result) return;

    if (result.accepted) {
      const newRoom = gameManager.createGame(room.timeControl);
      const newGameId = newRoom.gameId;

      const oldWhite = room.white;
      const oldBlack = room.black;

      newRoom.addPlayer(oldWhite.sessionId, oldWhite.socketId, oldWhite.name, 'b', oldWhite.userId);
      newRoom.addPlayer(oldBlack.sessionId, oldBlack.socketId, oldBlack.name, 'w', oldBlack.userId);
      newRoom.startGame();

      gameManager.trackSession(oldWhite.sessionId, newGameId);
      gameManager.trackSession(oldBlack.sessionId, newGameId);

      _setupGameCallbacks(io, newRoom, gameManager);

      [oldWhite, oldBlack].forEach((player) => {
        const sock = io.sockets.sockets.get(player.socketId);
        if (sock) {
          sock.leave(gameId);
          sock.join(newGameId);
        }
        io.to(player.socketId).emit('game:rematch_start', {
          gameId: newGameId,
          color: newRoom.getPlayerColor(player.socketId),
          fen: newRoom.chess.fen(),
          timeControl: newRoom.timeControl,
        });
      });

      // Cleanup old game
      gameManager.cleanupGame(gameId);
    } else if (result.declined) {
      io.to(gameId).emit('game:rematch_declined', {});
    }
  });

  // --- Game Leave (spectator navigating away without disconnect) ---

  socket.on('game:leave', ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    if (room.isSpectator(sessionId)) {
      room.removeSpectator(sessionId);
      socket.leave(gameId);
      io.to(gameId).emit('game:spectators_update', { count: room.getSpectatorCount() });
      broadcastLobbyState(io, lobbyManager);
    }
  });

  // --- Chat Events ---

  socket.on('chat:send', ({ gameId, message }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room || !message?.trim()) return;

    const msg = room.addChatMessage(socket.id, message);
    if (msg) {
      io.to(gameId).emit('chat:message', msg);
    }
  });

  // --- Cheers/Jeers ---

  socket.on('game:cheer', ({ gameId, targetColor }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room || !room.isSpectator(sessionId)) return;
    if (targetColor !== 'w' && targetColor !== 'b') return;

    // Check cooldown
    const lastCheer = cheerCooldowns.get(sessionId) || 0;
    if (Date.now() - lastCheer < CHEER_COOLDOWN_MS) return;

    // Check clocks — both must be > 30s
    if (room.clock) {
      const times = room.clock.getTimesMs();
      if (times.whiteTime < LOW_TIME_MS || times.blackTime < LOW_TIME_MS) return;
    }

    cheerCooldowns.set(sessionId, Date.now());
    const spec = room.spectators.get(sessionId);
    io.to(gameId).emit('game:cheer_received', {
      targetColor,
      senderName: spec?.name || 'Spectator',
    });
  });

  // --- Spectator Chat ---

  socket.on('spectator:chat:send', ({ gameId, message }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room || !room.isSpectator(sessionId) || !message?.trim()) return;

    const msg = room.addSpectatorChatMessage(sessionId, message);
    if (msg) {
      io.to(gameId).emit('spectator:chat:message', msg);
    }
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`Disconnected: socket=${socket.id} session=${sessionId}`);

    lobbyManager.removeFromQueue(sessionId);
    lobbyManager.removePendingBySession(sessionId);
    broadcastLobbyState(io, lobbyManager);

    // Clean up spectator from any game
    for (const [gId, room] of gameManager.games) {
      if (room.isSpectator(sessionId)) {
        room.removeSpectator(sessionId);
        io.to(gId).emit('game:spectators_update', { count: room.getSpectatorCount() });
        break;
      }
    }

    // Find any active game and handle disconnect
    const activeGame = gameManager.getActiveGameForSession(sessionId);
    if (activeGame && activeGame.status === 'active') {
      activeGame.handleDisconnect(sessionId);
      const opponent = activeGame.getOpponentOf(sessionId);
      if (opponent) {
        io.to(opponent.socketId).emit('game:opponent_disconnected', {
          timeout: 60,
        });
      }
    }
  });
}

// --- Helpers ---

function _emitGameStart(io, room, playerA, playerB) {
  const gameId = room.gameId;

  // Each player sees the OTHER player's name as opponentName
  const getOpponentName = (myColor) =>
    myColor === 'w' ? room.black.name : room.white.name;

  const sockA = io.sockets.sockets.get(playerA.socketId);
  if (sockA) {
    sockA.join(gameId);
    sockA.emit('lobby:game_start', {
      gameId,
      color: playerA.color,
      opponentName: getOpponentName(playerA.color),
      timeControl: room.timeControl,
      fen: room.chess.fen(),
    });
  }

  const sockB = io.sockets.sockets.get(playerB.socketId);
  if (sockB) {
    sockB.join(gameId);
    sockB.emit('lobby:game_start', {
      gameId,
      color: playerB.color,
      opponentName: getOpponentName(playerB.color),
      timeControl: room.timeControl,
      fen: room.chess.fen(),
    });
  }
}

function _setupGameCallbacks(io, room, gameManager, lobbyManager) {
  const gameId = room.gameId;

  room.onClockUpdate = (times) => {
    io.to(gameId).emit('game:clock_update', times);
  };

  room.onGameOver = (result) => {
    io.to(gameId).emit('game:over', result);
    gameManager.persistGame(gameId);
    broadcastLobbyState(io, lobbyManager);
  };
}
