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
      boardActions: null,
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
      setBoardActions(actions) {
        testState.boardActions = actions || null;
      },
      simulatePieceClick(piece, square) {
        return testState.boardActions?.pieceClick?.(piece, square);
      },
      simulateSquareClick(square, piece) {
        return testState.boardActions?.squareClick?.(square, piece);
      },
      simulatePieceDrop(from, to, piece) {
        return testState.boardActions?.pieceDrop?.(from, to, piece);
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

test('board drop handler moves a piece through the drag-drop path', async ({ page }) => {
  await installMockSocket(page, createScenario());
  await gotoGame(page);

  const dropAccepted = await page.evaluate(
    () => window.__CHESS_TEST_API__.simulatePieceDrop('e2', 'e4', 'wP')
  );

  expect(dropAccepted).toBe(true);
  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible();
  await expect.poll(() => getGameMoveEmits(page)).toEqual([
    { gameId: 'test-game', from: 'e2', to: 'e4' },
  ]);
});

test('queues and executes multiple premoves in order', async ({ page }) => {
  await installMockSocket(page, createScenario({
    fen: BLACK_TO_MOVE_START_FEN,
    turn: 'b',
  }));
  await gotoGame(page);

  await page.evaluate(() => window.__CHESS_TEST_API__.simulatePieceClick('wN', 'g1'));
  await settleUi(page);
  await page.evaluate(() => window.__CHESS_TEST_API__.simulateSquareClick('f3'));
  await settleUi(page);
  await page.evaluate(() => window.__CHESS_TEST_API__.simulatePieceClick('wN', 'f3'));
  await settleUi(page);
  await page.evaluate(() => window.__CHESS_TEST_API__.simulateSquareClick('g5'));
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

test('queues a drag premove through the drop handler and executes it on turn', async ({ page }) => {
  await installMockSocket(page, createScenario({
    fen: BLACK_TO_MOVE_START_FEN,
    turn: 'b',
  }));
  await gotoGame(page);

  const dropAccepted = await page.evaluate(
    () => window.__CHESS_TEST_API__.simulatePieceDrop('g1', 'f3', 'wN')
  );

  expect(dropAccepted).toBe(false);
  await expect.poll(() => getGameMoveEmits(page)).toEqual([]);
  await expect.poll(() => getPremoveQueue(page)).toEqual([
    { from: 'g1', to: 'f3' },
  ]);

  const blackMove = buildMovePayload(BLACK_TO_MOVE_START_FEN, { from: 'e7', to: 'e5' }, { whiteTime: 60_000, blackTime: 59_000 });
  await page.evaluate((payload) => window.__CHESS_TEST_API__.emitMoveMade(payload), blackMove);

  await expect.poll(() => getGameMoveEmits(page)).toEqual([
    { gameId: 'test-game', from: 'g1', to: 'f3' },
  ]);
});

test('desktop layout keeps board and chat sidebar separated and scrollable', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 700 },
  });
  const page = await context.newPage();

  try {
    await installMockSocket(page, createScenario());
    await gotoGame(page);

    const boardBox = await page.locator('.chessboard-wrap').boundingBox();
    const sidebarBox = await page.locator('.game-sidebar').boundingBox();
    const chatBox = await page.locator('.game-sidebar .chatbox').boundingBox();

    expect(boardBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(chatBox).not.toBeNull();
    const viewportCenter = page.viewportSize().width / 2;
    const boardCenter = boardBox.x + (boardBox.width / 2);
    expect(Math.abs(boardCenter - viewportCenter)).toBeLessThanOrEqual(48);
    expect(boardBox.x + boardBox.width + 12).toBeLessThan(sidebarBox.x);
    expect(chatBox.height).toBeGreaterThan(boardBox.height - 80);

    const scrollMetrics = await page.evaluate(() => ({
      scrollHeight: document.scrollingElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.innerHeight);

    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('app shell has no global chat panel or chat toggle', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.app-chat-panel')).toHaveCount(0);
  await expect(page.locator('.app-chat-mobile-overlay')).toHaveCount(0);
  await expect(page.getByTitle(/chat/i)).toHaveCount(0);
});

test('footer content spans the available desktop width', async ({ page }) => {
  await page.goto('/');

  const viewport = page.viewportSize();
  const footerBox = await page.locator('.site-footer-grid').boundingBox();

  expect(footerBox).not.toBeNull();
  expect(footerBox.x).toBeLessThanOrEqual(32);
  expect(viewport.width - (footerBox.x + footerBox.width)).toBeLessThanOrEqual(32);
});
