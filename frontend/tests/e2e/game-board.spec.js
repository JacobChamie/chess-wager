import { test, expect, devices } from '@playwright/test';
import { Chess } from 'chess.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

function createScenario(overrides = {}) {
  const state = {
    gameId: 'test-game',
    status: 'active',
    fen: START_FEN,
    turn: 'w',
    myColor: 'w',
    whiteName: 'Tester',
    blackName: 'Opponent',
    timeControl: { initial: 60, increment: 0 },
    whiteTime: 60_000,
    blackTime: 60_000,
    moves: [],
    chatMessages: [],
    spectatorChatMessages: [],
    spectatorCount: 0,
    drawOffer: null,
    isBotGame: false,
    botPersonality: null,
    ...overrides,
  };

  return {
    gameId: state.gameId,
    state,
  };
}

async function installMockSocket(page, scenario) {
  await page.addInitScript((injectedScenario) => {
    const listenerMap = new Map();
    const emitted = [];
    const testState = {
      premoveQueue: [],
    };
    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

    const emitToClient = (event, payload) => {
      const handlers = listenerMap.get(event) || [];
      handlers.forEach((handler) => handler(payload));
    };

    const socket = {
      connected: false,
      auth: {},
      on(event, handler) {
        const handlers = listenerMap.get(event) || [];
        handlers.push(handler);
        listenerMap.set(event, handlers);
      },
      off(event, handler) {
        if (!handler) {
          listenerMap.delete(event);
          return;
        }
        const handlers = (listenerMap.get(event) || []).filter((fn) => fn !== handler);
        if (handlers.length === 0) {
          listenerMap.delete(event);
          return;
        }
        listenerMap.set(event, handlers);
      },
      emit(event, payload) {
        emitted.push({ event, payload: clone(payload) });
        if (event === 'game:join' && payload?.gameId === injectedScenario.gameId) {
          queueMicrotask(() => emitToClient('game:state', clone(injectedScenario.state)));
        }
      },
      connect() {
        this.connected = true;
        queueMicrotask(() => emitToClient('connect'));
        return this;
      },
      disconnect() {
        this.connected = false;
        return this;
      },
    };

    window.__CHESS_TEST_SOCKET__ = socket;
    window.__CHESS_TEST_API__ = {
      clearEmitted() {
        emitted.length = 0;
      },
      getEmitted() {
        return clone(emitted);
      },
      getPremoveQueue() {
        return clone(testState.premoveQueue);
      },
      setPremoveQueue(queue) {
        testState.premoveQueue = clone(queue) || [];
      },
      emitGameState(state) {
        injectedScenario.state = clone(state);
        emitToClient('game:state', clone(state));
      },
      emitMoveMade(move) {
        injectedScenario.state = {
          ...injectedScenario.state,
          fen: move.fen,
          turn: move.turn,
          whiteTime: move.whiteTime,
          blackTime: move.blackTime,
          moves: move.moves || injectedScenario.state.moves,
        };
        emitToClient('game:move_made', clone(move));
      },
    };
  }, scenario);
}

function buildMovePayload(fen, move, clock = { whiteTime: 60_000, blackTime: 60_000 }, moves = []) {
  const chess = new Chess(fen);
  chess.move(move);
  return {
    from: move.from,
    to: move.to,
    fen: chess.fen(),
    turn: chess.turn(),
    whiteTime: clock.whiteTime,
    blackTime: clock.blackTime,
    moves,
  };
}

async function gotoGame(page) {
  await page.goto('/game/test-game');
  await expect(page.locator('[data-square="e2"]')).toBeVisible();
}

async function settleUi(page) {
  await page.waitForTimeout(50);
}

async function getGameMoveEmits(page) {
  return page.evaluate(() =>
    window.__CHESS_TEST_API__
      .getEmitted()
      .filter((entry) => entry.event === 'game:move')
      .map((entry) => entry.payload)
  );
}

async function getPremoveQueue(page) {
  return page.evaluate(() => window.__CHESS_TEST_API__.getPremoveQueue());
}

test('desktop click selects a piece and completes a click-to-move move', async ({ page }) => {
  await installMockSocket(page, createScenario());
  await gotoGame(page);

  await page.locator('[data-square="e2"]').click();
  await settleUi(page);
  await expect.poll(() => getGameMoveEmits(page)).toEqual([]);

  await page.locator('[data-square="e4"]').click();
  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible();

  await expect.poll(() => getGameMoveEmits(page)).toEqual([
    { gameId: 'test-game', from: 'e2', to: 'e4' },
  ]);
});

test('mobile tap selects and moves a piece', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();

  try {
    await installMockSocket(page, createScenario());
    await gotoGame(page);

    await page.locator('[data-square="g1"]').tap();
    await settleUi(page);
    await expect.poll(() => getGameMoveEmits(page)).toEqual([]);

    await page.locator('[data-square="f3"]').tap();
    await expect(page.locator('[data-square="f3"] [data-piece="wN"]')).toBeVisible();

    await expect.poll(() => getGameMoveEmits(page)).toEqual([
      { gameId: 'test-game', from: 'g1', to: 'f3' },
    ]);
  } finally {
    await context.close();
  }
});

test('queues and executes multiple premoves in order', async ({ page }) => {
  await installMockSocket(page, createScenario({
    fen: BLACK_TO_MOVE_START_FEN,
    turn: 'b',
  }));
  await gotoGame(page);

  await page.locator('[data-square="g1"]').click();
  await settleUi(page);
  await page.locator('[data-square="f3"]').click();
  await settleUi(page);
  await page.locator('[data-square="f3"]').click();
  await settleUi(page);
  await page.locator('[data-square="g5"]').click();
  await settleUi(page);

  await expect.poll(() => getGameMoveEmits(page)).toEqual([]);
  await expect.poll(() => getPremoveQueue(page)).toEqual([
    { from: 'g1', to: 'f3' },
    { from: 'f3', to: 'g5' },
  ]);

  const blackMoveOne = buildMovePayload(BLACK_TO_MOVE_START_FEN, { from: 'e7', to: 'e5' }, { whiteTime: 60_000, blackTime: 59_000 });
  await page.evaluate((payload) => window.__CHESS_TEST_API__.emitMoveMade(payload), blackMoveOne);

  await expect.poll(() => getGameMoveEmits(page)).toEqual([
    { gameId: 'test-game', from: 'g1', to: 'f3' },
  ]);
  await expect.poll(() => getPremoveQueue(page)).toEqual([
    { from: 'f3', to: 'g5' },
  ]);

  const chessAfterFirstPremove = new Chess(blackMoveOne.fen);
  chessAfterFirstPremove.move({ from: 'g1', to: 'f3' });
  const blackMoveTwo = buildMovePayload(chessAfterFirstPremove.fen(), { from: 'b8', to: 'c6' }, { whiteTime: 59_000, blackTime: 58_000 });
  await page.evaluate((payload) => window.__CHESS_TEST_API__.emitMoveMade(payload), blackMoveTwo);

  await expect.poll(() => getGameMoveEmits(page)).toEqual([
    { gameId: 'test-game', from: 'g1', to: 'f3' },
    { gameId: 'test-game', from: 'f3', to: 'g5' },
  ]);
  await expect.poll(() => getPremoveQueue(page)).toEqual([]);
});
