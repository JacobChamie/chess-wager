import { createRateLimiter } from '../utils/rateLimiter.js';
import { checkWagerGates } from '../wager/gateCheck.js';

const rateLimiter = createRateLimiter(15, 1000); // 15 events per second

// Global chat buffer (in-memory, last 100 messages)
const globalChatMessages = [];
const MAX_GLOBAL_MESSAGES = 100;
let globalMsgCounter = 0;

// Cheer cooldowns
const cheerCooldowns = new Map(); // sessionId -> timestamp
const CHEER_COOLDOWN_MS = 15000;
const LOW_TIME_MS = 30000;

// In-memory guard: prevents concurrent settlement of the same game from
// multiple async paths (checkmate move handler + onGameOver timeout callback).
const _settlingGames = new Set();

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

export function registerHandlers(io, socket, sessionId, gameManager, lobbyManager, authUser, botGameManager, wagerService, pool, fairPlayService) {
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
      sanitizedGates,
      authUser?.is_premium || false
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
        // Persist game row with wager_status='locked' so settleWager CAS works
        gameManager.persistGame(room.gameId).catch(() => {});
      }

      _emitGameStart(io, room, player1, player2);
      _setupGameCallbacks(io, room, gameManager, lobbyManager, wagerService, fairPlayService, pool);
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
      sanitizedGates,
      authUser?.is_premium || false
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
      authUser?.id || null,
      authUser?.is_premium || false
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
      // Persist game row with wager_status='locked' so settleWager CAS works
      gameManager.persistGame(room.gameId).catch(() => {});
    }

    _emitGameStart(io, room, creator, joiner);
    _setupGameCallbacks(io, room, gameManager, lobbyManager, wagerService, fairPlayService, pool);
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

  socket.on('game:get_active', () => {
    if (!checkRate()) return;
    const room = gameManager.getActiveGameForSession(sessionId);
    if (!room || room.status !== 'active') {
      socket.emit('game:active', { gameId: null });
      return;
    }

    const color = room.getPlayerColor(sessionId);
    const opponent = room.getOpponentOf(sessionId);
    socket.emit('game:active', {
      gameId: room.gameId,
      color,
      opponentName: opponent?.name || null,
      isBotGame: room.isBotGame || false,
    });
  });

  socket.on('game:move', async ({ gameId, from, to, promotion }) => {
    if (!checkRate()) return;
    const room = gameManager.getGame(gameId);
    if (!room) return;

    // Capture pre-move FEN before tryMove applies the move in-place
    const preFen = room.chess.fen();
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

    // Fire live cheat detection — non-blocking, never delays game:move_made
    if (fairPlayService?.liveDetector && !room.isBotGame && room.white?.userId && room.black?.userId) {
      const color = room.white.socketId === socket.id ? 'w' : 'b';
      const userId = color === 'w' ? room.white.userId : room.black.userId;
      const plyNumber = room.chess.history().length;
      const uci = from + to + (promotion || '');
      const lastEntry = room.moveHistory[room.moveHistory.length - 1];
      const moveTimeMs = (color === 'w' ? lastEntry?.white?.timeMs : lastEntry?.black?.timeMs) ?? 0;

      fairPlayService.liveDetector
        .checkMove(gameId, userId, preFen, uci, moveTimeMs, color, plyNumber)
        .then(flag => {
          if (flag) {
            io.to('admin').emit('fairplay:live_flag', flag);
            io.to(gameId).emit('fairplay:game_under_review', {
              gameId,
              message: 'This game has been flagged for review. Wager payout is pending.',
            });
          }
        })
        .catch(err => console.error('[LiveDetect]', err.message));
    }

    if (result.gameOver) {
      const wagerHeld = fairPlayService ? await _isWagerHeld(room.gameId, pool) : false;
      if (room.isWagerGame && room.wagerAmount > 0 && wagerService && !wagerHeld) {
        await _settleGameWager(room, result.gameOver, wagerService);
        result.gameOver.wagerHeld = false;
      } else if (wagerHeld) {
        result.gameOver.wagerHeld = true;
      }
      if (room.isWagerGame && room.wagerAmount > 0) {
        result.gameOver.wagerAmount = room.wagerAmount;
        result.gameOver.isWagerGame = true;
      }
      io.to(gameId).emit('game:over', result.gameOver);
      gameManager.persistGame(gameId);
      if (fairPlayService && !room.isBotGame && room.white?.userId && room.black?.userId) {
        _triggerAnalysis(io, room, result.gameOver, wagerHeld, fairPlayService, wagerService);
      }
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
      const wagerHeld = fairPlayService ? await _isWagerHeld(room.gameId, pool) : false;
      if (room.isWagerGame && room.wagerAmount > 0 && wagerService && !wagerHeld) {
        await _settleGameWager(room, result, wagerService);
        result.wagerHeld = false;
      } else if (wagerHeld) {
        result.wagerHeld = true;
      }
      if (room.isWagerGame && room.wagerAmount > 0) {
        result.wagerAmount = room.wagerAmount;
        result.isWagerGame = true;
      }
      io.to(gameId).emit('game:over', result);
      gameManager.persistGame(gameId);
      if (fairPlayService && !room.isBotGame && room.white?.userId && room.black?.userId) {
        _triggerAnalysis(io, room, result, wagerHeld, fairPlayService, wagerService);
      }
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
      const wagerHeld = fairPlayService ? await _isWagerHeld(room.gameId, pool) : false;
      if (room.isWagerGame && room.wagerAmount > 0 && wagerService && !wagerHeld) {
        await _settleGameWager(room, result, wagerService);
        result.wagerHeld = false;
      } else if (wagerHeld) {
        result.wagerHeld = true;
      }
      if (room.isWagerGame && room.wagerAmount > 0) {
        result.wagerAmount = room.wagerAmount;
        result.isWagerGame = true;
      }
      io.to(gameId).emit('game:over', result);
      gameManager.persistGame(gameId);
      if (fairPlayService && !room.isBotGame && room.white?.userId && room.black?.userId) {
        _triggerAnalysis(io, room, result, wagerHeld, fairPlayService, wagerService);
      }
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

      _setupGameCallbacks(io, newRoom, gameManager, lobbyManager, wagerService, fairPlayService, pool);

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

  // --- Global Chat ---

  socket.on('global:chat:history', () => {
    if (!checkRate()) return;
    socket.emit('global:chat:history', globalChatMessages);
  });

  socket.on('global:chat:send', ({ message }) => {
    if (!checkRate()) return;
    if (!authUser?.id) {
      socket.emit('global:chat:error', { message: 'You must be signed in to chat' });
      return;
    }
    if (!authUser.email_verified) {
      socket.emit('global:chat:error', { message: 'Please verify your email to chat' });
      return;
    }
    if (!message || typeof message !== 'string') return;
    const trimmed = message.trim().slice(0, 500);
    if (!trimmed) return;

    // HTML-escape
    const escaped = trimmed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const msg = {
      id: ++globalMsgCounter,
      sender: authUser.id,
      senderName: authUser.username,
      message: escaped,
      timestamp: Date.now(),
      isPremium: authUser.is_premium || false,
    };

    globalChatMessages.push(msg);
    if (globalChatMessages.length > MAX_GLOBAL_MESSAGES) {
      globalChatMessages.shift();
    }

    io.emit('global:chat:message', msg);
  });

  // --- Fair Play Events ---

  socket.on('fairplay:behavior', ({ gameId, data }) => {
    if (!checkRate()) return;
    if (!authUser?.id || !gameId || !data) return;
    if (fairPlayService) {
      fairPlayService.behaviorTracker.saveBehavior(gameId, authUser.id, data).catch(err =>
        console.error(`[FairPlay] Behavior save error:`, err.message)
      );
    }
  });

  socket.on('fairplay:report', async ({ reportedId, gameId, reason, details }) => {
    if (!checkRate()) return;
    if (!authUser?.id || !reportedId || !reason) return;
    if (fairPlayService) {
      try {
        await fairPlayService.submitReport(authUser.id, reportedId, gameId, reason, details);
        socket.emit('fairplay:report_success');
      } catch (err) {
        socket.emit('fairplay:report_error', { message: err.message });
      }
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
  const gameId = room.gameId;

  // In-memory guard: if another async path is already settling this game, skip.
  // The DB-level CAS in settleWager is the authoritative idempotency gate,
  // but this avoids even hitting the DB in the common concurrent-callback case.
  if (_settlingGames.has(gameId)) return;
  _settlingGames.add(gameId);

  try {
    const isDraw = result.result === '1/2-1/2';
    if (isDraw) {
      await wagerService.settleWager(
        gameId, room.white?.userId, room.black?.userId, room.wagerAmount, true
      );
    } else {
      const winnerUserId = result.winner === 'w' ? room.white?.userId : room.black?.userId;
      const loserUserId = result.winner === 'w' ? room.black?.userId : room.white?.userId;
      await wagerService.settleWager(
        gameId, winnerUserId, loserUserId, room.wagerAmount, false
      );
    }
  } catch (err) {
    console.error(`Wager settlement error for game ${gameId}:`, err.message);
  } finally {
    _settlingGames.delete(gameId);
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

/**
 * Check whether the game's wager is currently on hold (flagged mid-game).
 */
async function _isWagerHeld(gameId, pool) {
  try {
    const res = await pool.query('SELECT wager_status FROM games WHERE id = $1', [gameId]);
    return res.rows[0]?.wager_status === 'held';
  } catch {
    return false;
  }
}

/**
 * Fire post-game analysis and, when a wager was held, settle or confirm hold
 * based on the deep-analysis result.
 */
function _triggerAnalysis(io, room, gameOverResult, wagerWasHeld, fairPlayService, wagerService) {
  // Snapshot the room fields we need — the room object may be mutated later
  const savedGameId = room.gameId;
  const savedRoom = {
    gameId: room.gameId,
    white: room.white,
    black: room.black,
    wagerAmount: room.wagerAmount,
    isWagerGame: room.isWagerGame,
  };

  fairPlayService.analyzeGame(savedGameId)
    .then(async () => {
      fairPlayService.liveDetector?.cleanup(savedGameId);

      if (!wagerWasHeld || !savedRoom.isWagerGame || !savedRoom.wagerAmount || !wagerService) return;

      // Post-analysis: check how the live flag was resolved
      const resolution = await fairPlayService.getGameLiveFlagResolution(savedGameId);

      if (resolution === 'cleared') {
        // Deep analysis came back clean — settle now
        await _settleGameWager(savedRoom, gameOverResult, wagerService);
        io.to(savedGameId).emit('fairplay:payout_released', {
          gameId: savedGameId,
          wagerAmount: savedRoom.wagerAmount,
        });
      } else {
        // Confirmed cheat or still pending — hold for admin
        io.to(savedGameId).emit('fairplay:payout_held', {
          gameId: savedGameId,
          message: 'Payout held pending admin review.',
        });
      }
    })
    .catch(err => console.error(`[FairPlay] Analysis error for ${savedGameId}:`, err.message));
}

function _setupGameCallbacks(io, room, gameManager, lobbyManager, wagerService, fairPlayService, pool) {
  const gameId = room.gameId;

  room.onClockUpdate = (times) => {
    io.to(gameId).emit('game:clock_update', times);
  };

  room.onGameOver = async (result) => {
    const wagerHeld = (fairPlayService && pool) ? await _isWagerHeld(room.gameId, pool) : false;
    if (room.isWagerGame && room.wagerAmount > 0 && wagerService && !wagerHeld) {
      await _settleGameWager(room, result, wagerService);
      result.wagerHeld = false;
    } else if (wagerHeld) {
      result.wagerHeld = true;
    }
    if (room.isWagerGame && room.wagerAmount > 0) {
      result.wagerAmount = room.wagerAmount;
      result.isWagerGame = true;
    }

    io.to(gameId).emit('game:over', result);
    gameManager.persistGame(gameId);
    if (fairPlayService && !room.isBotGame && room.white?.userId && room.black?.userId) {
      _triggerAnalysis(io, room, result, wagerHeld, fairPlayService, wagerService);
    }
    broadcastLobbyState(io, lobbyManager, gameManager);
  };
}
