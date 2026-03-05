// Serialize time control for matching comparison
function tcKey(tc) {
  if (typeof tc === 'object') return `${tc.time}+${tc.increment || 0}`;
  return `${tc}+0`;
}

export class LobbyManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    // Matchmaking queue: [{ sessionId, socketId, playerName, timeControl }]
    this.queue = [];
    // Pending game links: gameId -> { sessionId, socketId, playerName, timeControl }
    this.pendingGames = new Map();
  }

  addToQueue(sessionId, socketId, playerName, timeControl, userId = null) {
    // Remove this socket if already in queue
    this.queue = this.queue.filter((e) => e.socketId !== socketId);

    this.queue.push({ sessionId, socketId, playerName, timeControl, userId });

    // Try to find a match with same time control (different socket)
    const myKey = tcKey(timeControl);
    const match = this.queue.find(
      (entry) =>
        entry.socketId !== socketId && tcKey(entry.timeControl) === myKey
    );

    if (match) {
      // Remove both from queue
      this.queue = this.queue.filter(
        (e) => e.socketId !== socketId && e.socketId !== match.socketId
      );
      return this._createMatch(
        { sessionId, socketId, playerName, timeControl },
        match
      );
    }

    return null; // No match yet, player is queued
  }

  removeFromQueue(sessionId) {
    this.queue = this.queue.filter((e) => e.sessionId !== sessionId);
  }

  removeFromQueueBySocket(socketId) {
    this.queue = this.queue.filter((e) => e.socketId !== socketId);
  }

  createPendingGame(sessionId, socketId, playerName, timeControl, userId = null) {
    const room = this.gameManager.createGame(timeControl);
    this.pendingGames.set(room.gameId, {
      sessionId,
      socketId,
      playerName,
      timeControl,
      userId,
    });
    return room.gameId;
  }

  joinPendingGame(gameId, sessionId, socketId, playerName, userId = null) {
    const pending = this.pendingGames.get(gameId);
    if (!pending) return { error: 'Game not found or already started' };

    if (pending.sessionId === sessionId) {
      return { error: 'Cannot join your own game' };
    }

    this.pendingGames.delete(gameId);

    const room = this.gameManager.getGame(gameId);
    if (!room) return { error: 'Game not found' };

    // Randomly assign colors
    const creatorIsWhite = Math.random() < 0.5;

    if (creatorIsWhite) {
      room.addPlayer(pending.sessionId, pending.socketId, pending.playerName, 'w', pending.userId);
      room.addPlayer(sessionId, socketId, playerName, 'b', userId);
    } else {
      room.addPlayer(sessionId, socketId, playerName, 'w', userId);
      room.addPlayer(pending.sessionId, pending.socketId, pending.playerName, 'b', pending.userId);
    }

    room.startGame();
    this.gameManager.trackSession(pending.sessionId, gameId);
    this.gameManager.trackSession(sessionId, gameId);

    return {
      room,
      creator: {
        sessionId: pending.sessionId,
        socketId: pending.socketId,
        color: creatorIsWhite ? 'w' : 'b',
      },
      joiner: {
        sessionId,
        socketId,
        color: creatorIsWhite ? 'b' : 'w',
      },
    };
  }

  removePendingBySession(sessionId) {
    for (const [gameId, pending] of this.pendingGames) {
      if (pending.sessionId === sessionId) {
        this.pendingGames.delete(gameId);
        this.gameManager.cleanupGame(gameId);
        break;
      }
    }
  }

  getOpenGames() {
    const games = [];
    for (const [gameId, pending] of this.pendingGames) {
      games.push({
        gameId,
        creatorName: pending.playerName,
        timeControl: pending.timeControl,
      });
    }
    return games;
  }

  getSeekers() {
    return this.queue.map((entry) => ({
      playerName: entry.playerName,
      timeControl: entry.timeControl,
    }));
  }

  _createMatch(player1, player2) {
    const room = this.gameManager.createGame(player1.timeControl);
    const gameId = room.gameId;

    // Random color assignment
    const p1IsWhite = Math.random() < 0.5;

    if (p1IsWhite) {
      room.addPlayer(player1.sessionId, player1.socketId, player1.playerName, 'w', player1.userId);
      room.addPlayer(player2.sessionId, player2.socketId, player2.playerName, 'b', player2.userId);
    } else {
      room.addPlayer(player2.sessionId, player2.socketId, player2.playerName, 'w', player2.userId);
      room.addPlayer(player1.sessionId, player1.socketId, player1.playerName, 'b', player1.userId);
    }

    room.startGame();
    this.gameManager.trackSession(player1.sessionId, gameId);
    this.gameManager.trackSession(player2.sessionId, gameId);

    return {
      room,
      player1: {
        ...player1,
        color: p1IsWhite ? 'w' : 'b',
      },
      player2: {
        ...player2,
        color: p1IsWhite ? 'b' : 'w',
      },
    };
  }
}
