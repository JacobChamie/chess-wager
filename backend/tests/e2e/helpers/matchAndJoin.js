import { connectClient, waitForEvent } from './createTestClient.js';

let counter = 0;

/**
 * Match two players via lobby:play, wait for lobby:game_start,
 * and identify which client is white / black.
 *
 * Returns { clientW, clientB, gameId, sessionW, sessionB }
 */
export async function matchAndJoin(url, opts = {}) {
  counter++;
  const sessionA = opts.sessionA || `sess-a-${counter}-${Date.now()}`;
  const sessionB = opts.sessionB || `sess-b-${counter}-${Date.now()}`;
  const tc = opts.timeControl || 300;
  const nameA = opts.nameA || 'Alice';
  const nameB = opts.nameB || 'Bob';

  const clientA = await connectClient(url, sessionA);
  const clientB = await connectClient(url, sessionB);

  const startA = waitForEvent(clientA, 'lobby:game_start');
  const startB = waitForEvent(clientB, 'lobby:game_start');

  clientA.emit('lobby:play', { timeControl: tc, playerName: nameA });
  clientB.emit('lobby:play', { timeControl: tc, playerName: nameB });

  const [dataA, dataB] = await Promise.all([startA, startB]);

  const gameId = dataA.gameId;
  const isAWhite = dataA.color === 'w';

  return {
    clientW: isAWhite ? clientA : clientB,
    clientB: isAWhite ? clientB : clientA,
    gameId,
    sessionW: isAWhite ? sessionA : sessionB,
    sessionB: isAWhite ? sessionB : sessionA,
  };
}
