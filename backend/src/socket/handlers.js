import { createRateLimiter } from '../utils/rateLimiter.js';
import { checkWagerGates } from '../wager/gateCheck.js';

const rateLimiter = createRateLimiter(15, 1000); // 15 events per second

// Cheer cooldowns
const cheerCooldowns = new Map(); // sessionId -> timestamp
const CHEER_COOLDOWN_MS = 15000;
const LOW_TIME_MS = 30000;

function broadcastLobbyState(io, lobbyManager, gameManager) {
  const activeGames = lobbyManager.getActiveGames();
  io.emit('lobby:state_update', {
    openGames: lobbyManager.getOpenGames(),
    seekers: lobbyManager.getSeekers(),
    activeGames,
  });
  // Also update the global stats (game count may have changed)
  if (gameManager) {
    io.emit('online:games', { games: activeGames.length });
  }
}

export function registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser, botGameManager, wagerService, pool) {
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

  socket.on('lobby:play', async ({ timeControl, playerName, colorPref, rating, wagerAmount, gates }) => {
    if (!checkRate()) return;
    let wager = parseFloat(wagerAmount) || 0;
    if (!Number.isFinite(wager) || wager < 0) wager = 0;
    if (wager > 10000) wager = 10000;
    wager = Math.round(wager * 100) / 100;

    const sanitizedGates = wager > 0 && gates ? {
      requireVerified: !!gates.requireVerified,
      minExternalRating: gates.minExternalRating ? parseInt(gates.minExternalRating) || null : null,
      minExternalPlatform: gates.minExternalPlatform || null,
      minExternalTimeControl: gates.minExternalTimeControl || null,
    } : null;

    const match = lobbyManager.addToQueue(
      sessionId,
      socket.id,
      playerName || 'Anonymous',
      timeControl || 300,
      authUser?.id || null,
      rating || null,
      colorPref || 'random',
      wager,
      sanitizedGates
    );

    if (match) {
      const { room, player1, player2 } = match;

      // Lock wager if applicable
      if (wager > 0 && wagerService) {
        room.wagerAmount = wager;
        room.isWagerGame = true;
        const lockResult = await wagerService.lockWager(
          room.gameId, room.white.userId, room.black.userId, wager
        );
        if (!lockResult.success) {
          socket.emit('lobby:error', { message: lockResult.error });
          gameManager.cleanupGame(room.gameId);
          broadcastLobbyState(io, lobbyManager, gameManager);
          return;
        }
      }

      _emitGameStart(io, room, player1, player2);
      _setupGameCallbacks(io, room, gameManager, lobbyManager, wagerService);
    } else {
      socket.emit('lobby:queued', {});
    }
    broadcastLobbyState(io, lobbyManager, gameManager);
  });

  socket.on('lobby:cancel_play', () => {
    if (!checkRate()) return;
    lobbyManager.removeFromQueue(sessionId);
    broadcastLobbyState(io, lobbyManager, gameManager);
  });

  socket.on('lobby:create_game', ({ timeControl, playerName, colorPref, rating, wagerAmount, gates }) => {
    if (!checkRate()) return;
    let wager = parseFloat(wagerAmount) || 0;
    if (!Number.isFinite(wager) || wager < 0) wager = 0;
    if (wager > 10000) wager = 10000;
    wager = Math.round(wager * 100) / 100;

    const sanitizedGates = wager > 0 && gates ? {
      requireVerified: !!gates.requireVerified,
      minExternalRating: gates.minExternalRating ? parseInt(gates.minExternalRating) || null : null,
      minExternalPlatform: gates.minExternalPlatform || null,
      minExternalTimeControl: gates.minExternalTimeControl || null,
    } : null;

    const gameId = lobbyManager.createPendingGame(
      sessionId,
      socket.id,
      playerName || 'Anonymous',
      timeControl || 300,
      authUser?.id || null,
      rating || null,
      colorPref || 'random',
      wager,
      sanitizedGates
    );
    socket.emit('lobby:game_created', { gameId });
    broadcastLobbyState(io, lobbyManager, gameManager);
  });

  socket.on('lobby:cancel_game', () => {
    if (!checkRate()) return;
    lobbyManager.removePendingBySession(sessionId);
    broadcastLobbyState(io, lobbyManager, gameManager);
  });

  socket.on('lobby:join_game', async ({ gameId, playerName }) => {
    if (!checkRate()) return;

    // Check wager gates before joining
    if (pool) {
      const pending = lobbyManager.pendingGames.get(gameId);
      if (pending?.gates && pending.wagerAmount > 0) {
        const gateResult = await checkWagerGates(pool, authUser?.id, pending.gates);
        if (!gateResult.pass) {
          socket.emit('lobby:error', { message: gateResult.reason });
          return;
        }
      }
    }

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

    // Lock wager if applicable
    if (room.wagerAmount > 0 && wagerService) {
      const lockResult = await wagerService.lockWager(
        room.gameId, room.white.userId, room.black.userId, room.wagerAmount
      );
      if (!lockResult.success) {
        socket.emit('lobby:error', { message: lockResult.error });
        gameManager.cleanupGame(room.gameId);
        broadcastLobbyState(io, lobbyManager, gameManager);
        return;
      }
    }

    _emitGameStart(io, room, creator, joiner);
    _setupGameCallbacks(io, room, gameManager, lobbyManager, wagerService);
    broadcastLobbyState(io, lobbyManager, gameManager);
  });

  // --- Bot Events ---

  socket.on('bot:get_personalities', () => {
    if (!checkRate()) return;
    if (!botGameManager) {
      socket.emit('bot:error', { message: 'Bot games unavailable' });
      return;
    }
    socket.emit('bot:personalities', botGameManager.getPersonalities());
  });

  socket.on('bot:start_game', ({ personalityId, timeControl, playerName, colorPref, isPrivate }) => {
    if (!checkRate()) return;
    if (!botGameManager) {
      socket.emit('bot:error', { message: 'Bot games unavailable' });
      return;
    }

    const result = botGameManager.createBotGame(
      io,
      sessionId,
      socket.id,
      playerName || authUser?.username || 'Anonymous',
      authUser?.id || null,
      personalityId,
      timeControl || { time: 300, increment: 0 },
      colorPref || 'random',
      !!isPrivate
    );

    if (result.error) {
      socket.emit('bot:error', { message: result.error });
      return;
    }

    const { room, gameId, humanColor } = result;

    socket.join(gameId);
    socket.emit('bot:game_start', {
      gameId,
      color: humanColor,
      opponentName: room.botPersonality.name,
      timeControl: room.timeControl,
      fen: room.chess.fen(),
      personality: {
        id: room.botPersonality.id,
        name: room.botPersonality.name,
        title: room.botPersonality.title,
        rating: room.botPersonality.rating,
      },
    });

    // Broadcast lobby update so bot game shows in Open Games (if not private)
    broadcastLobbyState(io, lobbyManager, gameManager);
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

  socket.on('game:move', async ({ gameId, from, to, promotion }) => {
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
      if (room.isWagerGame && room.wagerAmount > 0 && wagerService) {
        await _settleGameWager(room, result.gameOver, wagerService);
        result.gameOver.wagerAmount = room.wagerAmount;
        result.gameOver.isWagerGame = true;
      }
      io.to(gameId).emit('game:over', result.gameOver);
      gameManager.persistGame(gameId);
      broadcastLobbyState(io, lobbyManager, gameManager);
    }

    // Notify bot player if this is a bot game
    if (!result.gameOver && botGameManager?.isBotGame(gameId)) {
      botGameManager.onHumanMove(gameId, result);
    }
  });

  socket.on('game:resign', async ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.resign(socket.id);
    if (result) {
      if (room.isWagerGame && room.wagerAmount > 0 && wagerService) {
        await _settleGameWager(room, result, wagerService);
        result.wagerAmount = room.wagerAmount;
        result.isWagerGame = true;
      }
      io.to(gameId).emit('game:over', result);
      gameManager.persistGame(gameId);
      broadcastLobbyState(io, lobbyManager, gameManager);
    }
  });

  socket.on('game:offer_draw', ({ gameId }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.offerDraw(socket.id);
    if (result) {
      // Auto-decline draw offers in bot games
      if (room.isBotGame) {
        room.drawOffer = null;
        socket.emit('game:draw_declined', {});
        return;
      }
      const opponent = room.getOpponentOf(socket.id);
      if (opponent) {
        io.to(opponent.socketId).emit('game:draw_offered', {
          offeredBy: result.offeredBy,
        });
      }
    }
  });

  socket.on('game:respond_draw', async ({ gameId, accept }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    const result = room.respondDraw(socket.id, accept);
    if (!result) return;

    if (result.result) {
      if (room.isWagerGame && room.wagerAmount > 0 && wagerService) {
        await _settleGameWager(room, result, wagerService);
        result.wagerAmount = room.wagerAmount;
        result.isWagerGame = true;
      }
      io.to(gameId).emit('game:over', result);
      gameManager.persistGame(gameId);
      broadcastLobbyState(io, lobbyManager, gameManager);
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
      broadcastLobbyState(io, lobbyManager, gameManager);
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
    broadcastLobbyState(io, lobbyManager, gameManager);

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
      // Don't notify bot opponent (socketId is null)
      if (opponent?.socketId) {
        io.to(opponent.socketId).emit('game:opponent_disconnected', {
          timeout: 60,
        });
      }
    }
  });
}

// --- Helpers ---

async function _settleGameWager(room, result, wagerService) {
  try {
    const isDraw = result.result === '1/2-1/2';
    if (isDraw) {
      // Refund both — pass white as "winner" and black as "loser" (both get refunded)
      await wagerService.settleWager(
        room.gameId, room.white?.userId, room.black?.userId, room.wagerAmount, true
      );
    } else {
      const winnerUserId = result.winner === 'w' ? room.white?.userId : room.black?.userId;
      const loserUserId = result.winner === 'w' ? room.black?.userId : room.white?.userId;
      await wagerService.settleWager(
        room.gameId, winnerUserId, loserUserId, room.wagerAmount, false
      );
    }
  } catch (err) {
    console.error(`Wager settlement error for game ${room.gameId}:`, err.message);
  }
}

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

function _setupGameCallbacks(io, room, gameManager, lobbyManager, wagerService) {
  const gameId = room.gameId;

  room.onClockUpdate = (times) => {
    io.to(gameId).emit('game:clock_update', times);
  };

  room.onGameOver = async (result) => {
    // Settle wager if applicable
    if (room.isWagerGame && room.wagerAmount > 0 && wagerService) {
      await _settleGameWager(room, result, wagerService);
      result.wagerAmount = room.wagerAmount;
      result.isWagerGame = true;
    }

    io.to(gameId).emit('game:over', result);
    gameManager.persistGame(gameId);
    broadcastLobbyState(io, lobbyManager, gameManager);
  };
}
