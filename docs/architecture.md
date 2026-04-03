# ELO Stakes — Architecture

## High-Level System Overview

```mermaid
graph TB
    subgraph Client["Frontend (React + Vite)"]
        UI[React SPA<br/>elostakes.com]
        SC[Socket.IO Client]
        REST[HTTP / REST]
    end

    subgraph Server["Backend (Node.js + Express)"]
        IX[index.js<br/>Bootstrap & Wiring]
        SH[socket/handlers.js<br/>Real-Time Event Hub]

        subgraph Auth["Auth"]
            AS[authService.js<br/>JWT + bcrypt]
            AR[authRoutes.js<br/>Register / Login / Verify]
            AM[middleware.js<br/>authMiddleware / adminMiddleware]
        end

        subgraph GameEngine["Game Engine"]
            GM[GameManager<br/>Game Registry + Persistence]
            GR[GameRoom<br/>Board State + Clock + Chat]
            CM[ClockManager<br/>Per-Side Timers]
            LM[LobbyManager<br/>Matchmaking Queue]
        end

        subgraph BotSystem["Bot System"]
            BGM[BotGameManager<br/>Human vs Bot]
            BP[BotPlayer<br/>Move Generation]
            SE[StockfishEngine<br/>UCI WASM]
            PERS[botPersonalities.js<br/>6 Difficulty Levels]
        end

        subgraph WagerSystem["Wager & Escrow"]
            WS[WagerService<br/>Lock / Settle]
            GC[gateCheck.js<br/>Join Requirements]
        end

        subgraph CryptoSystem["Crypto Infrastructure"]
            WM[WalletManager<br/>HD Key Derivation]
            PS[PriceService<br/>CoinGecko Cache]
            DM[DepositMonitor<br/>ETH + SOL Polling]
            WP[WithdrawalProcessor<br/>Send Crypto]
            SM[SweepManager<br/>Fund Consolidation]
            CR[cryptoRoutes.js]
        end

        subgraph FairPlay["Anti-Cheat"]
            FPS[FairPlayService<br/>Orchestrator]
            GA[GameAnalyzer<br/>Post-Game Deep Analysis]
            AE[AnalysisEngine<br/>Stockfish MultiPV]
            LCD[LiveCheatDetector<br/>Real-Time Per-Move]
            BT[BehaviorTracker<br/>Client Telemetry]
        end

        subgraph Admin["Admin"]
            ADR[adminRoutes.js<br/>User / Game / Withdrawal Mgmt]
            BM[BotManager<br/>Stress Test Orchestrator]
        end

        subgraph Support["Supporting Services"]
            ES[emailService.js<br/>Resend API]
            LB[leaderboardRoutes.js]
            LA[linkedAccountRoutes.js<br/>Lichess OAuth + Chess.com]
            PR[premiumRoutes.js<br/>Subscriptions]
            PEC[PremiumExpiryChecker]
        end

        DB[(PostgreSQL)]
    end

    UI -->|WebSocket| SC
    SC <-->|socket.io| SH
    UI -->|fetch| REST
    REST --> AR
    REST --> CR
    REST --> LB
    REST --> LA
    REST --> PR
    REST --> ADR

    SH --> LM
    SH --> GM
    SH --> WS
    SH --> FPS
    SH --> BGM

    LM --> GM
    GM --> GR
    GR --> CM
    GM --> DB

    BGM --> BP
    BP --> SE
    BP --> GR

    WS --> DB
    GC --> DB

    FPS --> GA
    FPS --> LCD
    FPS --> BT
    FPS --> ES
    GA --> AE
    LCD --> AE
    FPS --> DB

    DM --> WM
    DM --> PS
    DM --> DB
    WP --> WM
    WP --> PS
    WP --> DB
    SM --> WM
    SM --> DB

    ADR --> BM
    ADR --> DB

    AR --> AS
    AR --> DB
    AR --> ES
    ADR --> AM

    PEC --> DB
    PR --> DB
```

## Game Lifecycle

```mermaid
sequenceDiagram
    participant A as Player A (White)
    participant S as Server (handlers.js)
    participant B as Player B (Black)
    participant DB as PostgreSQL

    Note over A,B: Matchmaking
    A->>S: lobby:play {timeControl, wagerAmount}
    B->>S: lobby:play {timeControl, wagerAmount}
    S->>S: LobbyManager.addToQueue() — match by TC + wager
    S->>S: GameManager.createGame() → GameRoom
    S->>S: WagerService.lockWager() [if wager > 0]
    S->>DB: Deduct tokens from both players + ledger entries
    S->>A: lobby:game_start {gameId, color: 'w'}
    S->>B: lobby:game_start {gameId, color: 'b'}

    Note over A,B: Gameplay
    A->>S: game:join {gameId}
    S->>A: game:state {fen, turn, clocks, wagerAmount...}
    B->>S: game:join {gameId}
    S->>B: game:state {fen, turn, clocks, wagerAmount...}

    loop Each Move
        A->>S: game:move {gameId, from, to}
        S->>S: GameRoom.tryMove() → validate + update chess.js
        S->>S: ClockManager.switchTurn()
        S-->>S: LiveCheatDetector.checkMove() [async, non-blocking]
        S->>A: game:move_made {san, fen, turn, clocks, moves}
        S->>B: game:move_made {san, fen, turn, clocks, moves}
        B->>S: game:move {gameId, from, to}
        S->>A: game:move_made {san, fen, turn, clocks, moves}
        S->>B: game:move_made {san, fen, turn, clocks, moves}
    end

    Note over A,B: Game Over (checkmate / resign / draw / timeout)
    S->>S: GameRoom._endGame() → stop clocks
    S->>S: WagerService.settleWager() [if wager > 0]
    S->>DB: Credit winner 2x (or refund both on draw) + ledger
    S->>A: game:over {result, reason, winner, isWagerGame, wagerAmount}
    S->>B: game:over {result, reason, winner, isWagerGame, wagerAmount}
    S->>S: GameManager.persistGame() → save to DB + update ELO
    S-->>S: FairPlayService.analyzeGame() [async, post-game]
```

## Wager Transaction Flow

```mermaid
sequenceDiagram
    participant W as White Player
    participant B as Black Player
    participant WS as WagerService
    participant DB as PostgreSQL
    participant LED as Ledger Table

    Note over W,LED: 1. Wager Lock (Game Start)
    WS->>DB: BEGIN TRANSACTION
    WS->>DB: UPDATE users SET token_balance -= amount WHERE id=white AND balance >= amount
    alt White has insufficient balance
        WS->>DB: ROLLBACK
        WS-->>W: lobby:error "insufficient balance"
    end
    WS->>DB: UPDATE users SET token_balance -= amount WHERE id=black AND balance >= amount
    alt Black has insufficient balance
        WS->>DB: ROLLBACK
        WS-->>B: lobby:error "insufficient balance"
    end
    WS->>LED: INSERT wager_lock (white, -amount)
    WS->>LED: INSERT wager_lock (black, -amount)
    WS->>DB: COMMIT
    Note over W,B: Both players' tokens are now in escrow

    Note over W,LED: 2. Settlement (Game Over)
    alt Winner Decided (checkmate / resign / timeout / abandonment)
        WS->>DB: BEGIN TRANSACTION
        WS->>DB: UPDATE users SET token_balance += (2 × amount) WHERE id=winner
        WS->>LED: INSERT wager_win (winner, +2×amount)
        WS->>DB: UPDATE games SET wager_status = 'settled'
        WS->>DB: COMMIT
    else Draw (agreement / stalemate / repetition / insufficient material)
        WS->>DB: BEGIN TRANSACTION
        WS->>DB: UPDATE users SET token_balance += amount WHERE id=white
        WS->>DB: UPDATE users SET token_balance += amount WHERE id=black
        WS->>LED: INSERT wager_refund (white, +amount)
        WS->>LED: INSERT wager_refund (black, +amount)
        WS->>DB: UPDATE games SET wager_status = 'settled'
        WS->>DB: COMMIT
    end
```

## Disconnect & Reconnect Flow

```mermaid
sequenceDiagram
    participant P as Disconnecting Player
    participant S as Server
    participant O as Opponent

    P->>S: [TCP connection drops]
    S->>S: GameRoom.handleDisconnect(sessionId)
    S->>S: Start 60-second forfeit timer
    S->>O: game:opponent_disconnected {timeout: 60}

    alt Player Reconnects (same sessionId)
        P->>S: [new socket connection with same sessionId]
        P->>S: game:join {gameId}
        S->>S: GameRoom.handleReconnect() → cancel timer, update socketId
        S->>P: game:state {full state: fen, moves, clocks, wager info}
        S->>O: game:opponent_reconnected
        Note over P,O: Game continues normally
    else 60 Seconds Elapse
        S->>S: Forfeit: _endGame('abandonment', opponent wins)
        S->>S: WagerService.settleWager() [if wager]
        S->>O: game:over {reason: 'abandonment', winner: opponent}
    end
```

## Anti-Cheat Pipeline

```mermaid
flowchart LR
    subgraph RealTime["Real-Time (During Game)"]
        M[Player Move] --> LCD[LiveCheatDetector]
        LCD --> SF1[Stockfish depth-12]
        SF1 --> METRICS[Rolling Metrics<br/>• Top-1 streak ≥ 6<br/>• Engine corr ≥ 85%<br/>• Flat timing + high corr]
        METRICS -->|Flag| HOLD[Wager HELD<br/>+ Admin Alert]
    end

    subgraph ClientSide["Client Telemetry"]
        BT[useBehaviorTracking] -->|fairplay:behavior| SAVE[BehaviorTracker.saveBehavior]
        BT -.->|Tracks| TAB[Tab switches]
        BT -.->|Tracks| FOCUS[Focus losses]
        BT -.->|Tracks| COPY[Copy/paste]
        BT -.->|Tracks| MOUSE[Mouse entropy]
        BT -.->|Tracks| DOM[DOM mutations]
        BT -.->|Tracks| FP[Canvas fingerprint]
    end

    subgraph PostGame["Post-Game Analysis"]
        OVER[Game Over] --> GA[GameAnalyzer]
        GA --> SF2[Stockfish depth-20<br/>MultiPV 3]
        SF2 --> DEEP[Deep Metrics<br/>• Strength score<br/>• ACPL<br/>• EPR<br/>• Timing correlation<br/>• Critical accuracy]
        DEEP --> AGG[FairPlayService<br/>Aggregate Trust Score]
        SAVE --> AGG
        AGG -->|Bayesian z ≥ 4.5<br/>over 20+ games| FLAG[User Flagged]
        AGG -->|Trust ≥ 60| CLEAR[Live Flag Cleared<br/>→ Wager Released]
        AGG -->|Trust < 60| CONFIRM[Flag Confirmed<br/>→ Wager Held for Admin]
    end
```

## Crypto Deposit / Withdrawal Flow

```mermaid
flowchart TB
    subgraph Deposit["Deposit Flow"]
        U1[User] -->|POST /deposit/address| ADDR[WalletManager<br/>HD Derive Address]
        ADDR --> QR[Show QR + Address]
        QR --> CHAIN[Blockchain<br/>ETH / SOL / USDC]
        CHAIN --> POLL[DepositMonitor<br/>30s polling]
        POLL -->|Detect TX| CONFIRM[Wait Confirmations<br/>ETH: 12 / SOL: 32]
        CONFIRM --> CREDIT[Credit token_balance<br/>USD 1:1 tokens]
        CREDIT --> EMAIL1[Deposit Receipt Email]
    end

    subgraph Withdrawal["Withdrawal Flow"]
        U2[User] -->|POST /withdraw| VALIDATE[Validate Address<br/>+ Balance Check]
        VALIDATE --> RAKE[Apply 3% Fee<br/>Premium: 0%]
        RAKE --> APPROVAL[Status: awaiting_approval]
        APPROVAL --> ADMIN[Admin Approve/Reject]
        ADMIN -->|Approve| PROCESS[WithdrawalProcessor<br/>Send on-chain TX]
        ADMIN -->|Reject| REFUND[Refund Tokens]
        PROCESS -->|Success| DONE[Status: confirmed]
        PROCESS -->|Failure| REFUND
    end

    subgraph Sweep["Fund Consolidation"]
        TIMER[5-min Interval] --> SM[SweepManager]
        SM --> MAIN[Sweep to Main Wallet<br/>ETH: keep gas / SOL: keep rent]
    end
```

## Database Schema (Key Tables)

```mermaid
erDiagram
    users {
        uuid id PK
        varchar username UK
        varchar email UK
        varchar password_hash
        int rating
        numeric token_balance
        boolean is_admin
        boolean is_banned
        boolean email_verified
        boolean is_premium
        timestamptz premium_expires_at
        varchar avatar_id
        varchar board_theme
        varchar animation_speed
        boolean profanity_filter
    }

    games {
        uuid id PK
        uuid white_user_id FK
        uuid black_user_id FK
        varchar status
        varchar result
        varchar reason
        text time_control
        text fen
        jsonb moves
        boolean is_bot_game
        boolean is_wager_game
        numeric wager_amount
        varchar wager_status
        timestamptz created_at
    }

    ledger {
        uuid id PK
        uuid user_id FK
        varchar type
        numeric amount
        numeric balance_after
        varchar reference_type
        varchar reference_id
        text description
        timestamptz created_at
    }

    game_analyses {
        uuid id PK
        uuid game_id FK
        jsonb white_metrics
        jsonb black_metrics
        int analysis_depth
        int book_cutoff
    }

    player_profiles {
        uuid user_id PK
        numeric trust_score
        int games_analyzed
        numeric avg_strength
        numeric avg_engine_corr
        numeric avg_acpl
        boolean is_flagged
    }

    deposits {
        uuid id PK
        uuid user_id FK
        varchar chain
        varchar asset
        varchar tx_hash
        numeric amount
        varchar status
    }

    withdrawals {
        uuid id PK
        uuid user_id FK
        varchar chain
        varchar asset
        numeric token_amount
        varchar status
        uuid approved_by FK
    }

    linked_accounts {
        uuid id PK
        uuid user_id FK
        varchar platform
        varchar external_username
        boolean is_verified
        jsonb ratings
    }

    users ||--o{ games : "plays"
    users ||--o{ ledger : "transactions"
    users ||--o{ deposits : "deposits"
    users ||--o{ withdrawals : "withdraws"
    users ||--o{ linked_accounts : "links"
    users ||--o| player_profiles : "has"
    games ||--o| game_analyses : "analyzed"
```

## Directory Structure

```
chess-wager/
├── frontend/                    # React SPA (Vite)
│   └── src/
│       ├── components/          # 21 React components (board, timers, chat, modals, etc.)
│       ├── pages/               # 10 page components (Lobby, Game, Admin, Wallet, etc.)
│       ├── hooks/               # useGameSocket, useBehaviorTracking, useGameTabTitle
│       ├── context/             # AuthContext (global auth state)
│       ├── utils/               # avatars, board themes, profanity filter
│       ├── App.jsx              # Router + layout
│       ├── socket.js            # Socket.IO client singleton
│       └── main.jsx             # Entry point
├── backend/                     # Node.js + Express + Socket.IO
│   ├── src/
│   │   ├── admin/               # Admin routes + stress-test bot manager
│   │   ├── auth/                # JWT auth, middleware, routes
│   │   ├── bot/                 # Stockfish engine, personalities, bot player
│   │   ├── config/              # DB pool + migration runner
│   │   ├── crypto/              # HD wallets, deposit/withdrawal, price service
│   │   ├── email/               # Resend API email service
│   │   ├── fairplay/            # Anti-cheat: live detection, post-game analysis, Bayesian scoring
│   │   ├── game/                # GameManager, GameRoom, ClockManager
│   │   ├── leaderboard/         # Public player rankings + game history
│   │   ├── linkedAccounts/      # Lichess OAuth + Chess.com verification
│   │   ├── lobby/               # Matchmaking queue + pending games
│   │   ├── premium/             # Subscription management
│   │   ├── socket/              # handlers.js — central real-time event hub
│   │   ├── utils/               # ID generator, rate limiter
│   │   ├── wager/               # WagerService (escrow) + gate checks
│   │   └── index.js             # Server bootstrap
│   ├── migrations/              # 17 sequential SQL migrations
│   ├── tests/
│   │   ├── unit/                # Vitest unit tests
│   │   ├── e2e/                 # Vitest E2E tests (socket.io-based)
│   │   ├── integration/         # Integration tests
│   │   ├── helpers/             # Mock pool, mock services, test setup
│   │   └── production/          # Production smoke test script
│   └── scripts/                 # seedAdmin.js
├── scripts/                     # Kaggle fixture preparation
└── docker-compose.yml           # Local dev stack
```
