export class LobbyManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    // Matchmaking queue: [{ sessionId, socketId, playerName, timeControl }]
    this.queue = [];
    // Pending game links: gameId -> { sessionId, socketId, playerName, timeControl }
    this.pendingGames = new Map();
  }

  addToQueue(sessionId, socketId, playerName, timeControl) {
    // Remove this socket if already in queue
    this.queue = this.queue.filter((e) => e.socketId !== socketId);

    this.queue.push({ sessionId, socketId, playerName, timeControl });

    // Try to find a match with same time control (different socket)
    const match = this.queue.find(
      (entry) =>
        entry.socketId !== socketId && entry.timeControl === timeControl
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

  createPendingGame(sessionId, socketId, playerName, timeControl) {
    const room = this.gameManager.createGame(timeControl);
    this.pendingGames.set(room.gameId, {
      sessionId,
      socketId,
      playerName,
      timeControl,
    });
    return room.gameId;
  }

  joinPendingGame(gameId, sessionId, socketId, playerName) {
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
      room.addPlayer(pending.sessionId, pending.socketId, pending.playerName, 'w');
      room.addPlayer(sessionId, socketId, playerName, 'b');
    } else {
      room.addPlayer(sessionId, socketId, playerName, 'w');
      room.addPlayer(pending.sessionId, pending.socketId, pending.playerName, 'b');
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

  _createMatch(player1, player2) {
    const room = this.gameManager.createGame(player1.timeControl);
    const gameId = room.gameId;

    // Random color assignment
    const p1IsWhite = Math.random() < 0.5;

    if (p1IsWhite) {
      room.addPlayer(player1.sessionId, player1.socketId, player1.playerName, 'w');
      room.addPlayer(player2.sessionId, player2.socketId, player2.playerName, 'b');
    } else {
      room.addPlayer(player2.sessionId, player2.socketId, player2.playerName, 'w');
      room.addPlayer(player1.sessionId, player1.socketId, player1.playerName, 'b');
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
