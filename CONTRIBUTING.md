# Contributing to ELO Stakes

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Git

### Local Setup

```bash
# Clone
git clone https://github.com/JacobChamie/chess-wager.git
cd chess-wager

# Backend
cd backend
cp .env.example .env          # Edit DATABASE_URL if needed
npm install
npm run dev                    # Starts on :3001 with --watch

# Frontend (separate terminal)
cd frontend
cp .env.example .env           # VITE_SERVER_URL=http://localhost:3001
npm install
npm run dev                    # Starts on :5173
```

### Running Tests

```bash
# Backend unit + e2e (no DB needed — uses mocks)
cd backend
npm test                       # All tests
npm run test:unit              # Unit only
npm run test:e2e               # E2E only (socket.io-based, no browser)

# Production smoke test (requires live server + DB access)
node tests/production/smokeTest.js --db-url "postgresql://..."
```

---

## Transactional Flow of a Wager

This section explains exactly what happens to money (tokens) when two players play a wager game, from the moment they click "Play" to the moment tokens land in the winner's balance.

### Overview

Wagers use a **lock-then-settle** escrow pattern. Tokens are deducted from both players atomically at game start and held until the game ends, at which point they are distributed based on the result. Every token movement is recorded in the `ledger` table for full auditability.

### Step 1: Matchmaking with Wager Amount

When a player clicks "Play" with a wager, the frontend emits:

```js
socket.emit('lobby:play', {
  timeControl: 300,
  playerName: 'Alice',
  wagerAmount: 10,        // tokens to wager
  gates: { ... }          // optional: requireVerified, minExternalRating
});
```

The `LobbyManager` only matches players with **identical wager amounts**. A 10-token player will never be matched with a 25-token player. Free games (`wagerAmount: 0`) are kept in a separate pool.

**Code path:** `socket/handlers.js` → `lobby:play` handler → `LobbyManager.addToQueue()`

### Step 2: Wager Lock (Game Start)

Once two players are matched, **before** the `lobby:game_start` event is emitted, the server locks tokens from both players inside a single database transaction:

```
handlers.js → WagerService.lockWager(gameId, whiteUserId, blackUserId, amount)
```

**What `lockWager` does** (file: `src/wager/WagerService.js`):

```sql
BEGIN;

-- Deduct from white (fails if insufficient balance)
UPDATE users SET token_balance = token_balance - 10
  WHERE id = 'white-uuid' AND token_balance >= 10
  RETURNING token_balance;

-- Deduct from black (fails if insufficient balance)
UPDATE users SET token_balance = token_balance - 10
  WHERE id = 'black-uuid' AND token_balance >= 10
  RETURNING token_balance;

-- Record in ledger
INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES ('white-uuid', 'wager_lock', -10, <new_balance>, 'game', 'game-id', 'Wager lock: 10 tokens');
INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES ('black-uuid', 'wager_lock', -10, <new_balance>, 'game', 'game-id', 'Wager lock: 10 tokens');

COMMIT;
```

**If either player's balance is too low**, the transaction rolls back and the game is aborted. The matched player receives a `lobby:error` event.

**Key guarantees:**
- Atomic: both deductions happen or neither does
- The `token_balance >= amount` check prevents overdraft
- The `CHECK (token_balance >= 0)` constraint on the `users` table is an additional safety net

### Step 3: The Game

During gameplay, the `GameRoom` tracks wager metadata:

```js
room.isWagerGame = true;
room.wagerAmount = 10;
```

This metadata is included in:
- `game:state` (sent on join/reconnect) — so the UI shows the wager badge
- `game:over` (sent on game end) — so the UI shows win/loss amounts

**Live cheat detection** runs asynchronously on every move. If the `LiveCheatDetector` flags a game, it sets `wager_status = 'held'` in the database and emits `fairplay:game_under_review` to both players. This prevents automatic settlement.

### Step 4: Settlement (Game Over)

When the game ends (checkmate, resign, draw, timeout, or abandonment), settlement happens in `handlers.js`:

```js
// Check if wager is being held by anti-cheat
const wagerHeld = await _isWagerHeld(room.gameId, pool);

if (room.isWagerGame && room.wagerAmount > 0 && wagerService && !wagerHeld) {
  await _settleGameWager(room, result, wagerService);
}
```

**What `settleWager` does** (file: `src/wager/WagerService.js`):

#### Case A: Winner Decided (checkmate, resign, timeout, abandonment)

```sql
BEGIN;

-- Winner gets the full pot (2x the wager amount)
UPDATE users SET token_balance = token_balance + 20
  WHERE id = 'winner-uuid'
  RETURNING token_balance;

INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES ('winner-uuid', 'wager_win', 20, <new_balance>, 'game', 'game-id', 'Wager win: 20 tokens');

UPDATE games SET wager_status = 'settled' WHERE id = 'game-id';

COMMIT;
```

The winner receives **2x the wager** (their own stake back + the opponent's stake). The loser receives nothing — their tokens were already deducted in Step 2.

#### Case B: Draw (agreement, stalemate, threefold repetition, insufficient material)

```sql
BEGIN;

-- Refund both players
UPDATE users SET token_balance = token_balance + 10 WHERE id = 'white-uuid' RETURNING token_balance;
UPDATE users SET token_balance = token_balance + 10 WHERE id = 'black-uuid' RETURNING token_balance;

INSERT INTO ledger (user_id, type, amount, ...) VALUES ('white-uuid', 'wager_refund', 10, ...);
INSERT INTO ledger (user_id, type, amount, ...) VALUES ('black-uuid', 'wager_refund', 10, ...);

UPDATE games SET wager_status = 'settled' WHERE id = 'game-id';

COMMIT;
```

Both players get their original wager back. No one profits.

### Step 5: Anti-Cheat Hold (When Applicable)

If the `LiveCheatDetector` flagged the game during play, `wager_status` is `'held'` and automatic settlement is skipped. Instead:

1. `FairPlayService.analyzeGame()` runs a deep post-game analysis (Stockfish depth-20, MultiPV 3)
2. If the analysis **clears** the player (trust score >= 60), settlement proceeds automatically and `fairplay:payout_released` is emitted
3. If the analysis **confirms** the flag (trust score < 60), the wager remains held and `fairplay:payout_held` is emitted — an admin must manually resolve it

**Admin resolution paths** (via `adminRoutes.js` or `fairplayRoutes.js`):
- **Clear flag**: Admin settles the wager normally
- **Confirm cheating**: Admin can ban the player and refund the opponent via transaction reversal

### Ledger Entry Types

| Type | Direction | When |
|------|-----------|------|
| `wager_lock` | -amount | Game starts, tokens enter escrow |
| `wager_win` | +2×amount | Winner receives full pot |
| `wager_refund` | +amount | Draw — both players refunded |
| `admin_reversal` | ±amount | Admin manually reverses a transaction |
| `withdrawal_refund` | +amount | Rejected withdrawal refunded |

### Token Balance Invariant

At any point in time, for any user:

```
token_balance = SUM(all ledger entries for that user)
```

Every credit and debit is recorded atomically alongside the balance update within the same database transaction. The `CHECK (token_balance >= 0)` constraint ensures balances never go negative.

---

## Wager Gate System

Creators of wager games can set optional requirements that opponents must meet:

| Gate | What It Checks |
|------|---------------|
| `requireVerified` | Opponent must have a verified linked account (Lichess or Chess.com) with 100+ games |
| `minExternalRating` | Opponent's rating on a specified platform/time-control must be >= threshold |

Gate checks run in `wager/gateCheck.js` when a player tries to join a gated game via `lobby:join_game`. If the check fails, the join is rejected with a `lobby:error` explaining why.

---

## Code Organization Conventions

- **Backend**: Plain ES modules (`.js`), no TypeScript. Classes for stateful services, functions for stateless routes.
- **Frontend**: React functional components with hooks. No Redux — context + socket events for state.
- **Tests**: Vitest for both unit and E2E. E2E tests spin up real Express + Socket.IO servers on random ports with mock DB pools.
- **Database**: Sequential numbered SQL migrations in `backend/migrations/`. Applied automatically on startup by `config/db.js`.
- **No ORM**: Raw `pg` queries with parameterized SQL. Transactions via `pool.connect()` + `BEGIN/COMMIT/ROLLBACK`.

## Adding a New Feature

1. **Backend service**: Add a new directory under `backend/src/` with your service class
2. **Wire it up**: Import and instantiate in `index.js`, pass to `registerHandlers` if it needs socket access
3. **Socket events**: Add handlers in `socket/handlers.js` following the existing pattern (rate limit check, room lookup, emit results)
4. **REST endpoints**: Create a router file, mount it in `index.js` with appropriate middleware
5. **Database**: Add a new migration file (increment the prefix number)
6. **Tests**: Add E2E tests in `backend/tests/e2e/` using `createTestServer` + `connectClient` helpers
7. **Frontend**: Add components/pages, use `socket.emit`/`socket.on` for real-time features
