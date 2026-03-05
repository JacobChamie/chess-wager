import { io as io_client } from 'socket.io-client';
import { Chess } from 'chess.js';
import { pool } from '../config/db.js';
import { hashPassword } from '../auth/authService.js';
import { createToken } from '../auth/authService.js';
import { nanoid } from 'nanoid';

const BOT_NAMES = [
  'Bot_Alpha', 'Bot_Beta', 'Bot_Gamma', 'Bot_Delta',
  'Bot_Epsilon', 'Bot_Zeta', 'Bot_Eta', 'Bot_Theta',
];

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      }, { once: true });
    }
  });
}

export class BotManager {
  constructor() {
    this.running = false;
    this.bots = new Map(); // name -> { userId, token, sessionId, socket, chess, gameId, color, moveCount }
    this.log = [];
    this.config = null;
    this.abortController = null;
    this.gamesPlayed = 0;
    this.currentRound = 0;
  }

  _log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.log.push(line);
    if (this.log.length > 200) this.log.shift();
    console.log(`[BotManager] ${msg}`);
  }

  getStatus() {
    return {
      running: this.running,
      log: this.log.slice(-50),
      gamesPlayed: this.gamesPlayed,
      currentRound: this.currentRound,
      totalRounds: this.config?.rounds || 0,
      botCount: this.bots.size,
    };
  }

  async start(io, config, gameManager) {
    if (this.running) throw new Error('Stress test already running');

    this.running = true;
    this._gameManager = gameManager;
    this._io = io;
    this.log = [];
    this.gamesPlayed = 0;
    this.currentRound = 0;
    this.abortController = new AbortController();
    this.config = {
      botCount: config.botCount || 6,
      timeControl: config.timeControl || { time: 180, increment: 0 },
      movesBeforeEnd: config.movesBeforeEnd || 6,
      endMethod: config.endMethod || 'mixed',
      rounds: config.rounds || 3,
      delayMs: config.delayMs || 500,
    };

    const signal = this.abortController.signal;
    this._log(`Starting stress test: ${this.config.botCount} bots, ${this.config.rounds} rounds`);

    try {
      // 1. Create bot accounts
      await this._createBotAccounts();

      // 2. Connect sockets
      await this._connectBots(io);

      // 3. Run rounds
      for (let round = 1; round <= this.config.rounds; round++) {
        if (!this.running) break;
        this.currentRound = round;
        this._log(`--- Round ${round}/${this.config.rounds} ---`);
        await this._runRound(signal);
        if (round < this.config.rounds && this.running) {
          await sleep(1000, signal);
        }
      }

      this._log(`Stress test completed: ${this.gamesPlayed} games played`);
    } catch (err) {
      if (err.message !== 'aborted') {
        this._log(`Error: ${err.message}`);
        console.error('[BotManager] Error:', err);
      }
    }

    // Auto-stop if we finished naturally
    if (this.running) {
      await this.stop();
    }
  }

  async stop() {
    if (!this.running && this.bots.size === 0) return;
    this._log('Stopping stress test...');
    this.running = false;

    // Signal abort to cancel pending delays
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Collect all bot sessionIds
    const botSessionIds = new Set();
    for (const [name, bot] of this.bots) {
      if (bot.sessionId) botSessionIds.add(bot.sessionId);
    }

    // Find ALL games involving bot sessions BEFORE disconnecting sockets
    const botGameIds = new Set();
    if (this._gameManager) {
      for (const [gameId, room] of this._gameManager.games) {
        const whiteIsBot = botSessionIds.has(room.white?.sessionId);
        const blackIsBot = botSessionIds.has(room.black?.sessionId);
        if (whiteIsBot || blackIsBot) {
          botGameIds.add(gameId);
          // Force-end active games so they don't linger
          if (room.status === 'active') {
            room._endGame('1/2-1/2', 'abandoned', null);
            // Notify any spectators
            if (this._io) {
              this._io.to(gameId).emit('game:over', {
                result: '1/2-1/2',
                reason: 'abandoned',
                winner: null,
              });
            }
          }
        }
      }

      // Now clean up all bot games from memory
      for (const gameId of botGameIds) {
        this._gameManager.cleanupGame(gameId);
      }
      this._log(`Cleaned up ${botGameIds.size} games from memory`);
    }

    // Disconnect all bot sockets AFTER game cleanup
    for (const [name, bot] of this.bots) {
      try {
        if (bot.socket?.connected) {
          bot.socket.disconnect();
        }
      } catch (err) {
        // Ignore disconnect errors
      }
    }

    // Clean up DB
    const botUserIds = [...this.bots.values()].map(b => b.userId).filter(Boolean);
    if (botUserIds.length > 0) {
      try {
        await pool.query('DELETE FROM games WHERE white_user_id = ANY($1) OR black_user_id = ANY($1)', [botUserIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [botUserIds]);
        this._log(`Cleaned up ${botUserIds.length} bot users and their games from DB`);
      } catch (err) {
        this._log(`DB cleanup error: ${err.message}`);
      }
    }

    // Broadcast fresh lobby state to all connected clients
    if (this._io) {
      this._io.emit('lobby:state_update', {
        openGames: [],
        seekers: [],
        activeGames: this._gameManager?.getActiveGames() || [],
      });
    }

    this.bots.clear();
    this._gameManager = null;
    this._io = null;
    this._log('Stress test stopped and cleaned up');
  }

  async _createBotAccounts() {
    const count = Math.min(this.config.botCount, BOT_NAMES.length);
    const passwordHash = await hashPassword('bot_stress_test_pw');

    for (let i = 0; i < count; i++) {
      const name = BOT_NAMES[i];
      const displayName = `[BOT] ${name}`;
      const email = `${name.toLowerCase()}@stress.test`;

      // Delete existing bot user if any (from a previous unclean shutdown)
      await pool.query('DELETE FROM games WHERE white_user_id IN (SELECT id FROM users WHERE email = $1) OR black_user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
      await pool.query('DELETE FROM users WHERE email = $1', [email]);

      const result = await pool.query(
        'INSERT INTO users (username, email, password_hash, rating) VALUES ($1, $2, $3, 1200) RETURNING id',
        [displayName, email, passwordHash]
      );

      const userId = result.rows[0].id;
      const token = createToken({ id: userId, username: displayName, email, is_admin: false });
      const sessionId = `bot_${nanoid(10)}`;

      this.bots.set(name, {
        userId,
        token,
        sessionId,
        socket: null,
        chess: null,
        gameId: null,
        color: null,
        moveCount: 0,
      });

      this._log(`Created bot: ${displayName} (${userId})`);
    }
  }

  async _connectBots(io) {
    const port = process.env.PORT || 3001;
    const serverUrl = `http://localhost:${port}`;

    const connectPromises = [];

    for (const [name, bot] of this.bots) {
      const promise = new Promise((resolve, reject) => {
        const socket = io_client(serverUrl, {
          auth: { sessionId: bot.sessionId, token: bot.token },
          transports: ['websocket'],
          forceNew: true,
        });

        const timeout = setTimeout(() => {
          socket.disconnect();
          reject(new Error(`Bot ${name} connection timeout`));
        }, 10000);

        socket.on('connect', () => {
          clearTimeout(timeout);
          bot.socket = socket;
          this._log(`Bot ${name} connected (${socket.id})`);
          resolve();
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject(new Error(`Bot ${name} connect error: ${err.message}`));
        });
      });

      connectPromises.push(promise);
    }

    await Promise.all(connectPromises);
    this._log(`All ${this.bots.size} bots connected`);
  }

  async _runRound(signal) {
    const botNames = [...this.bots.keys()];

    // Shuffle for random pairing
    for (let i = botNames.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [botNames[i], botNames[j]] = [botNames[j], botNames[i]];
    }

    // Pair bots
    const pairs = [];
    const spectators = [];

    for (let i = 0; i + 1 < botNames.length; i += 2) {
      pairs.push([botNames[i], botNames[i + 1]]);
    }
    if (botNames.length % 2 !== 0) {
      spectators.push(botNames[botNames.length - 1]);
    }

    this._log(`Pairs: ${pairs.map(p => `${p[0]} vs ${p[1]}`).join(', ')}${spectators.length ? ` | Spectators: ${spectators.join(', ')}` : ''}`);

    // Start all pair games concurrently
    const gamePromises = pairs.map((pair, idx) => this._playGame(pair[0], pair[1], spectators, idx, signal));
    await Promise.all(gamePromises);
  }

  async _playGame(name1, name2, spectatorNames, pairIndex, signal) {
    const bot1 = this.bots.get(name1);
    const bot2 = this.bots.get(name2);

    if (!bot1?.socket?.connected || !bot2?.socket?.connected) {
      this._log(`Skipping ${name1} vs ${name2}: bot disconnected`);
      return;
    }

    // Determine end method for this game
    let endMethod = this.config.endMethod;
    if (endMethod === 'mixed') {
      endMethod = Math.random() < 0.5 ? 'resign' : 'draw';
    }

    // Reset game state
    bot1.gameId = null;
    bot1.color = null;
    bot1.moveCount = 0;
    bot1.chess = new Chess();
    bot2.gameId = null;
    bot2.color = null;
    bot2.moveCount = 0;
    bot2.chess = new Chess();

    return new Promise(async (resolve) => {
      let gameFinished = false;
      const cleanup = () => {
        bot1.socket.removeAllListeners('lobby:game_start');
        bot1.socket.removeAllListeners('game:move_made');
        bot1.socket.removeAllListeners('game:over');
        bot2.socket.removeAllListeners('lobby:game_start');
        bot2.socket.removeAllListeners('game:move_made');
        bot2.socket.removeAllListeners('game:over');
      };

      const finishGame = (forceResignBot = null) => {
        if (gameFinished) return;
        gameFinished = true;
        // If we need to force-resign (e.g. timeout), do it before cleanup
        if (forceResignBot?.socket?.connected && forceResignBot.gameId) {
          forceResignBot.socket.emit('game:resign', { gameId: forceResignBot.gameId });
        }
        cleanup();
        this.gamesPlayed++;
        resolve();
      };

      // Listen for game over
      const onGameOver = (botName) => (data) => {
        this._log(`Game over (${botName}): ${data.result} - ${data.reason}`);
        finishGame();
      };

      bot1.socket.on('game:over', onGameOver(name1));
      bot2.socket.on('game:over', onGameOver(name2));

      // Move handler
      const onMoveMade = (botName, bot) => (data) => {
        if (gameFinished || !this.running) return;

        bot.chess.load(data.fen);
        bot.moveCount = data.moves?.length || bot.moveCount;

        // Check if it's this bot's turn
        const turn = data.turn; // 'w' or 'b'
        if (turn !== bot.color) return;

        const totalMoves = data.moves?.length || 0;

        // Check if we should end the game
        if (totalMoves >= this.config.movesBeforeEnd) {
          setTimeout(() => {
            if (gameFinished || !this.running) return;

            if (endMethod === 'resign') {
              this._log(`${botName} resigns after ${totalMoves} moves`);
              bot.socket.emit('game:resign', { gameId: bot.gameId });
            } else {
              // Draw offer flow — register accept handler BEFORE sending offer
              const otherBot = bot === bot1 ? bot2 : bot1;
              const acceptHandler = () => {
                if (gameFinished || !this.running) return;
                otherBot.socket.emit('game:respond_draw', { gameId: otherBot.gameId, accept: true });
              };
              otherBot.socket.once('game:draw_offered', acceptHandler);

              this._log(`${botName} offers draw after ${totalMoves} moves`);
              bot.socket.emit('game:offer_draw', { gameId: bot.gameId });

              // Fallback: if draw doesn't resolve in 5s, just resign
              setTimeout(() => {
                if (gameFinished || !this.running) return;
                this._log(`${botName} draw timeout — resigning instead`);
                otherBot.socket.removeAllListeners('game:draw_offered');
                bot.socket.emit('game:resign', { gameId: bot.gameId });
              }, 5000);
            }
          }, this.config.delayMs);
          return;
        }

        // Make a random legal move
        setTimeout(() => {
          if (gameFinished || !this.running) return;
          const moves = bot.chess.moves({ verbose: true });
          if (moves.length === 0) return;

          const move = moves[Math.floor(Math.random() * moves.length)];
          bot.socket.emit('game:move', {
            gameId: bot.gameId,
            from: move.from,
            to: move.to,
            promotion: move.promotion || undefined,
          });
        }, this.config.delayMs);
      };

      bot1.socket.on('game:move_made', onMoveMade(name1, bot1));
      bot2.socket.on('game:move_made', onMoveMade(name2, bot2));

      // Listen for game start
      const onGameStart = (botName, bot) => (data) => {
        bot.gameId = data.gameId;
        bot.color = data.color;
        this._log(`${botName} joined game ${data.gameId} as ${data.color === 'w' ? 'white' : 'black'}`);

        // Join the socket room
        bot.socket.emit('game:join', { gameId: data.gameId });

        // If white, make the first move after delay
        if (data.color === 'w') {
          setTimeout(() => {
            if (gameFinished || !this.running) return;
            const moves = bot.chess.moves({ verbose: true });
            if (moves.length === 0) return;
            const move = moves[Math.floor(Math.random() * moves.length)];
            bot.socket.emit('game:move', {
              gameId: bot.gameId,
              from: move.from,
              to: move.to,
              promotion: move.promotion || undefined,
            });
          }, this.config.delayMs);
        }
      };

      bot1.socket.on('lobby:game_start', onGameStart(name1, bot1));
      bot2.socket.on('lobby:game_start', onGameStart(name2, bot2));

      // Both bots emit lobby:play with same time control
      const tc = this.config.timeControl;
      const displayName1 = `[BOT] ${name1}`;
      const displayName2 = `[BOT] ${name2}`;

      bot1.socket.emit('lobby:play', {
        timeControl: tc,
        playerName: displayName1,
        colorPref: 'random',
        rating: 1200,
      });

      // Small delay before second bot joins to avoid race conditions
      await sleep(100, signal).catch(() => {});

      bot2.socket.emit('lobby:play', {
        timeControl: tc,
        playerName: displayName2,
        colorPref: 'random',
        rating: 1200,
      });

      // Timeout: if game doesn't finish in 15s, force resign
      const gameTimeout = setTimeout(() => {
        if (!gameFinished) {
          this._log(`Game timeout for ${name1} vs ${name2} — force resigning`);
          finishGame(bot1);
        }
      }, 15000);

      // Also handle abort signal
      const onAbort = () => {
        clearTimeout(gameTimeout);
        finishGame(bot1);
      };

      if (signal.aborted) {
        clearTimeout(gameTimeout);
        finishGame(bot1);
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });

      // Spectators join after a brief delay
      if (spectatorNames.length > 0 && !gameFinished) {
        setTimeout(async () => {
          // Wait until we have a gameId from one of the bots
          const waitForGameId = () => bot1.gameId || bot2.gameId;
          let gameId = waitForGameId();
          let attempts = 0;
          while (!gameId && attempts < 20 && !gameFinished) {
            await sleep(100, signal).catch(() => {});
            gameId = waitForGameId();
            attempts++;
          }

          if (!gameId || gameFinished) return;

          for (const specName of spectatorNames) {
            const specBot = this.bots.get(specName);
            if (!specBot?.socket?.connected) continue;

            specBot.socket.emit('game:join', { gameId });
            this._log(`${specName} spectating game ${gameId}`);

            // Send spectator chat
            setTimeout(() => {
              if (gameFinished || !this.running) return;
              specBot.socket.emit('spectator:chat:send', {
                gameId,
                message: 'Go go go! 🔥',
              });
            }, 2000);

            // Send a cheer
            setTimeout(() => {
              if (gameFinished || !this.running) return;
              specBot.socket.emit('game:cheer', {
                gameId,
                targetColor: Math.random() < 0.5 ? 'w' : 'b',
              });
            }, 3000);
          }
        }, 500);
      }
    });
  }
}
