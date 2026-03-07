import { GameRoom } from '../../src/game/GameRoom.js';

/**
 * Create a GameRoom with two players already started.
 * Returns { room, whiteSession, blackSession }.
 */
export function createStartedGame(opts = {}) {
  const timeControl = opts.timeControl || { time: 300, increment: 0 };
  const room = new GameRoom(opts.gameId || 'test-game', timeControl);

  const whiteSession = opts.whiteSession || 'white-session';
  const blackSession = opts.blackSession || 'black-session';

  room.addPlayer(whiteSession, 'white-socket', opts.whiteName || 'Alice', 'w');
  room.addPlayer(blackSession, 'black-socket', opts.blackName || 'Bob', 'b');
  room.startGame();

  return { room, whiteSession, blackSession };
}

/**
 * Play a sequence of moves on a room, alternating white/black.
 * `moves` is an array of { from, to, promotion? } objects.
 */
export function playMoves(room, whiteId, blackId, moves) {
  const results = [];
  for (let i = 0; i < moves.length; i++) {
    const playerId = i % 2 === 0 ? whiteId : blackId;
    const result = room.tryMove(playerId, moves[i]);
    results.push(result);
    if (!result.valid) break;
  }
  return results;
}
