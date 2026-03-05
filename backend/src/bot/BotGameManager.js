import { nanoid } from 'nanoid';
import { BotPlayer } from './BotPlayer.js';
import { BOT_PERSONALITIES, getPersonality } from './botPersonalities.js';

export class BotGameManager {
  constructor(gameManager, engine) {
    this.gameManager = gameManager;
    this.engine = engine;
    this.activeBotGames = new Map(); // gameId -> BotPlayer
  }

  getPersonalities() {
    return BOT_PERSONALITIES.map(({ id, name, title, description, rating }) => ({
      id, name, title, description, rating,
    }));
  }

  /**
   * Create a new bot game.
   * @returns {{ room, gameId, humanColor, error? }}
   */
  createBotGame(io, humanSessionId, humanSocketId, humanName, humanUserId, personalityId, timeControl, colorPref) {
    const personality = getPersonality(personalityId);
    if (!personality) {
      return { error: 'Invalid bot personality' };
    }

    // Resolve colors
    let humanColor, botColor;
    if (colorPref === 'white') {
      humanColor = 'w'; botColor = 'b';
    } else if (colorPref === 'black') {
      humanColor = 'b'; botColor = 'w';
    } else {
      humanColor = Math.random() < 0.5 ? 'w' : 'b';
      botColor = humanColor === 'w' ? 'b' : 'w';
    }

    const room = this.gameManager.createGame(timeControl);
    const gameId = room.gameId;
    const botSessionId = `bot_${personalityId}_${nanoid(6)}`;

    // Mark as bot game
    room.isBotGame = true;
    room.botPersonality = personality;

    // Add players
    room.addPlayer(humanSessionId, humanSocketId, humanName, humanColor, humanUserId);
    room.addPlayer(botSessionId, null, personality.name, botColor, null);

    room.startGame();

    this.gameManager.trackSession(humanSessionId, gameId);

    // Create and start bot player
    const botPlayer = new BotPlayer(room, botColor, personality, this.engine);
    botPlayer.botSessionId = botSessionId;
    this.activeBotGames.set(gameId, botPlayer);

    // When bot makes a move, broadcast it
    botPlayer.onMove((result) => {
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
        this.gameManager.persistGame(gameId);
        this._cleanup(gameId);
      }
    });

    // Set up clock broadcast
    room.onClockUpdate = (times) => {
      io.to(gameId).emit('game:clock_update', times);
    };

    // Handle timeout (clock runs out)
    room.onGameOver = (result) => {
      io.to(gameId).emit('game:over', result);
      this.gameManager.persistGame(gameId);
      this._cleanup(gameId);
    };

    botPlayer.start();

    return { room, gameId, humanColor };
  }

  /**
   * Called after a human makes a move in a bot game.
   */
  onHumanMove(gameId, moveResult) {
    const botPlayer = this.activeBotGames.get(gameId);
    if (botPlayer) {
      botPlayer.onHumanMove(moveResult);
    }
  }

  /**
   * Check if a game is a bot game.
   */
  isBotGame(gameId) {
    return this.activeBotGames.has(gameId);
  }

  _cleanup(gameId) {
    const botPlayer = this.activeBotGames.get(gameId);
    if (botPlayer) {
      botPlayer.destroy();
      this.activeBotGames.delete(gameId);
    }
  }

  /**
   * Clean up all active bot games (for shutdown).
   */
  destroyAll() {
    for (const [gameId, botPlayer] of this.activeBotGames) {
      botPlayer.destroy();
    }
    this.activeBotGames.clear();
  }
}
