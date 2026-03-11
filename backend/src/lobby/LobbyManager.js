// Serialize time control for matching comparison
function tcKey(tc) {
  if (typeof tc === 'object') return `${tc.time}+${tc.increment || 0}`;
  return `${tc}+0`;
}

// Determine if player1 should be white based on color preferences
function resolveColors(pref1, pref2) {
  if (pref1 === 'white' && pref2 !== 'white') return true;
  if (pref1 === 'black' && pref2 !== 'black') return false;
  if (pref2 === 'white' && pref1 !== 'white') return false;
  if (pref2 === 'black' && pref1 !== 'black') return true;
  return Math.random() < 0.5;
}

export class LobbyManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    // Matchmaking queue: [{ sessionId, socketId, playerName, timeControl }]
    this.queue = [];
    // Pending game links: gameId -> { sessionId, socketId, playerName, timeControl }
    this.pendingGames = new Map();
  }

  addToQueue(sessionId, socketId, playerName, timeControl, userId = null, rating = null, colorPref = 'random', wagerAmount = 0, gates = null) {
    // Remove this socket if already in queue
    this.queue = this.queue.filter((e) => e.socketId !== socketId);

    this.queue.push({ sessionId, socketId, playerName, timeControl, userId, rating, colorPref, wagerAmount, gates });

    // Try to find a match with same time control + same wager amount (different socket)
    const myKey = tcKey(timeControl);
    const myWager = wagerAmount || 0;
    const match = this.queue.find(
      (entry) =>
        entry.socketId !== socketId &&
        tcKey(entry.timeControl) === myKey &&
        (entry.wagerAmount || 0) === myWager
    );

    if (match) {
      // Remove both from queue
      this.queue = this.queue.filter(
        (e) => e.socketId !== socketId && e.socketId !== match.socketId
      );
      return this._createMatch(
        { sessionId, socketId, playerName, timeControl, userId, colorPref, wagerAmount, gates },
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

  createPendingGame(sessionId, socketId, playerName, timeControl, userId = null, rating = null, colorPref = 'random', wagerAmount = 0, gates = null) {
    const room = this.gameManager.createGame(timeControl);
    if (wagerAmount > 0) {
      room.wagerAmount = wagerAmount;
      room.isWagerGame = true;
    }
    this.pendingGames.set(room.gameId, {
      sessionId,
      socketId,
      playerName,
      timeControl,
      userId,
      rating,
      colorPref,
      wagerAmount,
      gates,
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

    // Assign colors based on creator's preference
    const creatorIsWhite = resolveColors(pending.colorPref || 'random', 'random');

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
        creatorSessionId: pending.sessionId,
        timeControl: pending.timeControl,
        rating: pending.rating,
        colorPref: pending.colorPref,
        wagerAmount: pending.wagerAmount || 0,
        gates: pending.gates || null,
      });
    }
    return games;
  }

  getActiveGames() {
    return this.gameManager.getActiveGames();
  }

  getSeekers() {
    return this.queue.map((entry) => ({
      sessionId: entry.sessionId,
      playerName: entry.playerName,
      timeControl: entry.timeControl,
      rating: entry.rating,
      colorPref: entry.colorPref,
      wagerAmount: entry.wagerAmount || 0,
      gates: entry.gates || null,
    }));
  }

  _createMatch(player1, player2) {
    const room = this.gameManager.createGame(player1.timeControl);
    const gameId = room.gameId;

    // Set wager if applicable
    const wager = player1.wagerAmount || 0;
    if (wager > 0) {
      room.wagerAmount = wager;
      room.isWagerGame = true;
    }

    // Color assignment based on preferences
    const p1IsWhite = resolveColors(player1.colorPref || 'random', player2.colorPref || 'random');

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
