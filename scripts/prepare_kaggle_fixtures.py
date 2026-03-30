#!/usr/bin/env python3
"""
Kaggle Chess Cheating Dataset — Fixture Preparation Script
===========================================================

Downloads the Kaggle chess cheating dataset, samples games, converts PGN to
our moveHistory format with simulated timing, then runs Stockfish analysis
via chess.engine to compute the same metrics GameAnalyzer.js computes.

Outputs two JSON files:
  backend/tests/fixtures/kaggle_sample.json    — raw move history (no analysis)
  backend/tests/fixtures/kaggle_analyzed.json  — pre-computed metrics per game

Requirements:
  pip install kagglehub pandas python-chess

Usage:
  python scripts/prepare_kaggle_fixtures.py [--games 100] [--stockfish-path /path/to/stockfish]
"""

import argparse
import json
import math
import os
import random
import sys
from pathlib import Path

# ── Third-party imports ────────────────────────────────────────────────────

try:
    import kagglehub
    import pandas as pd
    import chess
    import chess.pgn
    import chess.engine
    import io
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install kagglehub pandas python-chess")
    sys.exit(1)

# ── Constants ──────────────────────────────────────────────────────────────

DATASET   = "brieucdandoy/chess-cheating-dataset"
BOOK_PLY  = 20          # skip first 10 full moves
DEPTH     = 18          # Max depth cap; actual limit is time-based (see MOVE_TIME_S)
MOVE_TIME_S = 0.15      # 150ms per position — fast enough for 100 games, still signals cheating
MULTI_PV  = 3           # top-N moves to evaluate

SCRIPT_DIR  = Path(__file__).parent
FIXTURES_DIR = SCRIPT_DIR.parent / "backend" / "tests" / "fixtures"
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

# ── Timing simulation ──────────────────────────────────────────────────────

def simulate_timing(n_moves: int, is_cheating: bool) -> list[int]:
    """
    Generate per-move think times (ms) that mimic human vs engine play.

    Human-like (honest): log-normal distribution, high CV (> 0.8).
    Engine-like (cheat): nearly uniform, low CV (< 0.15).
    """
    rng = random.Random()
    times = []
    for i in range(n_moves):
        if is_cheating:
            # Flat timing: small Gaussian noise around 3.5s
            t = max(500, int(rng.gauss(3500, 350)))
        else:
            # Human: log-normal centred at ~5s, fat tails
            log_t = rng.gauss(8.1, 1.0)   # ln(3300) ≈ 8.1
            t = max(300, min(int(math.exp(log_t)), 90_000))
        times.append(t)
    return times


# ── PGN → our moveHistory format ──────────────────────────────────────────

def pgn_to_move_history(
    pgn_string: str,
    is_cheating_white: bool,
    is_cheating_black: bool,
) -> list[dict] | None:
    """
    Parse a PGN string and return a moveHistory array in the format
    expected by GameAnalyzer.js:
      [{ moveNumber, white: {san, fen, timeMs}, black: {san, fen, timeMs} | null }]
    """
    try:
        game = chess.pgn.read_game(io.StringIO(pgn_string))
        if game is None:
            return None
        board = game.board()
        moves = list(game.mainline_moves())
    except Exception:
        return None

    # Generate timing for each move separately
    white_indices = [i for i in range(len(moves)) if i % 2 == 0]
    black_indices = [i for i in range(len(moves)) if i % 2 == 1]
    white_times = simulate_timing(len(white_indices), is_cheating_white)
    black_times = simulate_timing(len(black_indices), is_cheating_black)

    wi = bi = 0
    move_history = []

    for i, move in enumerate(moves):
        san = board.san(move)
        board.push(move)
        fen = board.fen()
        is_white = i % 2 == 0

        if is_white:
            move_history.append({
                "moveNumber": len(move_history) + 1,
                "white":  {"san": san, "fen": fen, "timeMs": white_times[wi]},
                "black":  None,
            })
            wi += 1
        else:
            if move_history:
                move_history[-1]["black"] = {"san": san, "fen": fen, "timeMs": black_times[bi]}
            bi += 1

    return move_history if len(move_history) >= 10 else None


# ── Stockfish metric computation ───────────────────────────────────────────

def pearson(x: list[float], y: list[float]) -> float:
    n = len(x)
    if n < 2:
        return 0.0
    mx = sum(x) / n; my = sum(y) / n
    num = sum((x[i]-mx)*(y[i]-my) for i in range(n))
    denx = sum((v-mx)**2 for v in x)
    deny = sum((v-my)**2 for v in y)
    den = math.sqrt(denx * deny)
    return num / den if den else 0.0


def analyze_player_side(
    move_history: list[dict],
    color: str,           # 'w' or 'b'
    engine: chess.engine.SimpleEngine,
    rating: int,
) -> dict:
    """
    Analyse one player's moves with Stockfish and compute the same metrics
    as GameAnalyzer._computePlayerMetrics.
    """
    board = chess.Board()
    ply = 0
    player_results = []

    for row in move_history:
        for side, color_flag in [("white", "w"), ("black", "b")]:
            entry = row.get(side)
            if not entry:
                continue
            ply += 1
            san = entry["san"]
            time_ms = entry.get("timeMs", 0)

            if ply <= BOOK_PLY:
                try:
                    board.push_san(san)
                except Exception:
                    board = chess.Board()  # reset on invalid
                continue

            pre_fen = board.fen()
            move_obj = None
            try:
                move_obj = board.parse_san(san)
            except Exception:
                try:
                    board.push_san(san)
                except Exception:
                    pass
                continue

            legal_count = board.legal_moves.count()

            # Analyse position BEFORE the move
            try:
                info = engine.analyse(board, chess.engine.Limit(time=MOVE_TIME_S, depth=DEPTH), multipv=MULTI_PV)
            except Exception:
                board.push(move_obj)
                continue

            if not info:
                board.push(move_obj)
                continue

            uci_played = move_obj.uci()

            # Find rank of played move
            match_rank = 0
            for rank, pv_info in enumerate(info, start=1):
                top_uci = pv_info["pv"][0].uci() if pv_info.get("pv") else ""
                if top_uci == uci_played:
                    match_rank = rank
                    break

            # Centipawn values (from side to move's perspective)
            def cp(pv_info):
                sc = pv_info.get("score", chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE))
                pov = sc.pov(board.turn)
                if pov.is_mate():
                    return 2000 * (1 if pov.mate() > 0 else -1)
                return pov.score() or 0

            best_cp = cp(info[0]) if info else 0

            was_capture = board.is_capture(move_obj)

            if match_rank > 0:
                played_cp = cp(info[match_rank - 1])
                cp_loss = max(0, min(500, abs(best_cp - played_cp)))
            else:
                # Move not in top-N: use a board copy so we don't corrupt state
                post_board = board.copy()
                post_board.push(move_obj)
                try:
                    post_info = engine.analyse(post_board, chess.engine.Limit(time=MOVE_TIME_S, depth=min(DEPTH, 16)))
                    player_cp = -(post_info.get("score", chess.engine.PovScore(chess.engine.Cp(0), post_board.turn)).pov(post_board.turn).score() or 0)
                    cp_loss = max(0, min(500, abs(best_cp - player_cp)))
                except Exception:
                    cp_loss = 100

            # Complexity metrics (computed from pre-move board)
            pieces = sum(1 for sq in chess.SQUARES if board.piece_at(sq) and board.piece_at(sq).piece_type != chess.KING)
            eval_spread = abs(cp(info[0]) - cp(info[2])) if len(info) >= 3 else (abs(cp(info[0]) - cp(info[1])) if len(info) >= 2 else 0)
            complexity = (legal_count / 30) * (1 + eval_spread / 150) * (pieces / 30)
            complexity = max(0.2, min(3.0, complexity))
            if pieces <= 6:   complexity *= 0.3
            elif pieces <= 10: complexity *= 0.6

            is_critical = eval_spread > 150 and legal_count > 15

            if color_flag == color:
                player_results.append({
                    "matchRank":  match_rank,
                    "cpLoss":     cp_loss,
                    "complexity": complexity,
                    "timeMs":     time_ms,
                    "isCritical": is_critical,
                    "wasCapture": was_capture,
                    "wasCheck":   board.is_check(),
                    "legalCount": legal_count,
                })

            board.push(move_obj)

    if not player_results:
        return None

    # --- Aggregate metrics ---
    n = len(player_results)
    top1 = sum(1 for m in player_results if m["matchRank"] == 1)
    engine_corr = top1 / n

    cp_losses  = [m["cpLoss"] for m in player_results]
    acpl       = sum(cp_losses) / n

    cp_arr = cp_losses
    cx_arr = [m["complexity"] for m in player_results]
    cploss_complexity_corr = pearson(cp_arr, cx_arr) if n >= 10 else None

    weighted = sum(
        (1.0 if m["matchRank"] == 1 else 0.5 if m["matchRank"] == 2 else 0.2 if m["matchRank"] == 3 else 0)
        * m["complexity"] for m in player_results
    )
    total_cx = sum(m["complexity"] for m in player_results)
    strength_score = (weighted / total_cx * 150) if total_cx > 0 else 0

    # Timing
    tm_arr = [m["timeMs"] for m in player_results if m["timeMs"] > 0]
    timing_suspicion = 0.0
    if len(tm_arr) >= 10:
        cx_for_tm = [player_results[i]["complexity"] for i, m in enumerate(player_results) if m["timeMs"] > 0]
        r = pearson(tm_arr, cx_for_tm[:len(tm_arr)])
        timing_suspicion = max(0, min(1, (0.2 - r) / 0.4))

    # Flat timing CV
    think = [m for m in player_results if m["timeMs"] > 1500 and not m["wasCapture"] and not m["wasCheck"]]
    flat_timing_cv = None
    if len(think) >= 8:
        ts = [m["timeMs"] for m in think]
        mean_t = sum(ts) / len(ts)
        if mean_t > 0:
            var_t = sum((t - mean_t)**2 for t in ts) / (len(ts) - 1)
            flat_timing_cv = round(math.sqrt(var_t) / mean_t, 3)

    # EPR
    expected = expected_strength(rating)
    epr = round(rating + (strength_score - expected) * 15)

    # Critical accuracy
    crits = [m for m in player_results if m["isCritical"]]
    crit_acc = (sum(1 for m in crits if m["matchRank"] == 1) / len(crits)) if len(crits) >= 3 else 0.0

    return {
        "engineCorr":          round(engine_corr, 3),
        "acpl":                round(acpl, 1),
        "strengthScore":       round(strength_score, 1),
        "timingSuspicion":     round(timing_suspicion, 3),
        "flatTimingCV":        flat_timing_cv,
        "cpLossComplexityCorr": round(cploss_complexity_corr, 3) if cploss_complexity_corr is not None else None,
        "criticalAccuracy":    round(crit_acc, 3),
        "epr":                 epr,
        "moveCount":           n,
    }


def expected_strength(rating: int) -> float:
    anchors = [(800,35),(1200,50),(1600,60),(2000,72),(2400,82),(2700,88)]
    clamped = max(800, min(2700, rating))
    for i in range(len(anchors) - 1):
        r1, s1 = anchors[i]; r2, s2 = anchors[i+1]
        if r1 <= clamped <= r2:
            return s1 + (clamped - r1) / (r2 - r1) * (s2 - s1) + 3
    return 88.0


# ── Sampling strategy ──────────────────────────────────────────────────────

def stockfish_rate(cheat_str) -> float:
    """
    Parse the per-move cheat string (e.g. '1101001...') and return the
    fraction of moves that were Stockfish-generated.
    A player is considered cheating if this rate is > 0.
    """
    s = str(cheat_str).strip()
    if not s or s in ('nan', 'None'):
        return 0.0
    chars = [c for c in s if c in ('0', '1')]
    if not chars:
        return 0.0
    return sum(int(c) for c in chars) / len(chars)


def sample_games(df: "pd.DataFrame", n: int) -> "pd.DataFrame":
    """
    Sample a balanced set of games from each category:
      - clean (neither side cheating)
      - white only cheating
      - black only cheating
      - both cheating
    """
    # Compute cheat rates from per-move binary strings
    df = df.copy()
    df['_w_rate'] = df['Liste cheat white'].apply(stockfish_rate)
    df['_b_rate'] = df['Liste cheat black'].apply(stockfish_rate)

    groups = {
        "clean":       df[(df['_w_rate'] == 0) & (df['_b_rate'] == 0)],
        "white_cheat": df[(df['_w_rate'] >  0) & (df['_b_rate'] == 0)],
        "black_cheat": df[(df['_w_rate'] == 0) & (df['_b_rate'] >  0)],
        "both_cheat":  df[(df['_w_rate'] >  0) & (df['_b_rate'] >  0)],
    }
    per_group = max(1, n // len(groups))
    sampled = []
    for name, group in groups.items():
        k = min(per_group, len(group))
        sampled.append(group.sample(k, random_state=42))
        print(f"  {name}: sampled {k} / {len(group)}")
    return pd.concat(sampled).reset_index(drop=True)


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=100, help="Total games to sample (default 100)")
    parser.add_argument("--stockfish-path", default=None, help="Path to Stockfish binary")
    parser.add_argument("--no-analysis", action="store_true", help="Skip Stockfish analysis (only build move fixtures)")
    args = parser.parse_args()

    print(f"Downloading Kaggle dataset: {DATASET}")
    dataset_path = kagglehub.dataset_download(DATASET)
    csv_path = os.path.join(dataset_path, "Games.csv")
    print(f"Dataset path: {dataset_path}")
    df = pd.read_csv(csv_path)
    print(f"Loaded {len(df)} games. Columns: {list(df.columns)}")

    print(f"\nSampling {args.games} games...")
    sample_df = sample_games(df, args.games)

    # ── Build raw move history fixtures ─────────────────────────────────────
    raw_games = []
    skipped = 0
    for idx, row in sample_df.iterrows():
        w_rate  = row.get('_w_rate', 0)
        b_rate  = row.get('_b_rate', 0)
        cheat_w = 1 if w_rate > 0 else 0
        cheat_b = 1 if b_rate > 0 else 0
        elo_w   = int(row.get("Elo White",  1500))
        elo_b   = int(row.get("Elo Black",  1500))
        pgn     = str(row.get("Game", ""))

        mh = pgn_to_move_history(pgn, bool(cheat_w), bool(cheat_b))
        if mh is None:
            skipped += 1
            continue

        raw_games.append({
            "gameId":        f"kaggle_{idx}",
            "cheatingWhite": cheat_w,
            "cheatingBlack": cheat_b,
            "stockfishRateWhite": round(w_rate, 3),
            "stockfishRateBlack": round(b_rate, 3),
            "eloWhite":     elo_w if elo_w != -1 else 1500,
            "eloBlack":     elo_b if elo_b != -1 else 1500,
            "score":        str(row.get("Score", "*")),
            "moves":        mh,
        })

    print(f"Converted {len(raw_games)} games ({skipped} skipped)")

    raw_out = FIXTURES_DIR / "kaggle_sample.json"
    with open(raw_out, "w") as f:
        json.dump({"games": raw_games, "total": len(raw_games)}, f)
    print(f"Saved: {raw_out}")

    if args.no_analysis:
        print("Skipping Stockfish analysis (--no-analysis)")
        return

    # ── Stockfish analysis ───────────────────────────────────────────────────
    sf_path = args.stockfish_path
    if not sf_path:
        # Try common locations
        for candidate in ["/usr/local/bin/stockfish", "/usr/bin/stockfish",
                          "/opt/homebrew/bin/stockfish", "stockfish"]:
            import shutil
            if shutil.which(candidate):
                sf_path = candidate
                break
    if not sf_path:
        print("\nStockfish not found. Install it or pass --stockfish-path.")
        print("Run with --no-analysis to skip analysis and only build move fixtures.")
        sys.exit(1)

    print(f"\nRunning Stockfish analysis (depth {DEPTH}, MultiPV {MULTI_PV}) on {len(raw_games)} games...")
    print("This may take 20-60 minutes depending on hardware.\n")

    analyzed_games = []
    try:
        with chess.engine.SimpleEngine.popen_uci(sf_path) as engine:
            for i, game in enumerate(raw_games):
                print(f"  [{i+1}/{len(raw_games)}] {game['gameId']} (W cheat={game['cheatingWhite']}, B cheat={game['cheatingBlack']})", end=" ", flush=True)
                w_metrics = analyze_player_side(game["moves"], "w", engine, game["eloWhite"])
                b_metrics = analyze_player_side(game["moves"], "b", engine, game["eloBlack"])
                print(f"→ W:{w_metrics['engineCorr']:.2f}/{w_metrics['acpl']:.0f}  B:{b_metrics['engineCorr']:.2f}/{b_metrics['acpl']:.0f}")

                analyzed_games.append({
                    "gameId":       game["gameId"],
                    "cheatingWhite": game["cheatingWhite"],
                    "cheatingBlack": game["cheatingBlack"],
                    "eloWhite":     game["eloWhite"],
                    "eloBlack":     game["eloBlack"],
                    "white":        w_metrics,
                    "black":        b_metrics,
                })
    except KeyboardInterrupt:
        print("\nInterrupted — saving partial results")

    analyzed_out = FIXTURES_DIR / "kaggle_analyzed.json"
    with open(analyzed_out, "w") as f:
        json.dump({"games": analyzed_games, "total": len(analyzed_games)}, f, indent=2)
    print(f"\nSaved: {analyzed_out}")

    # Summary
    if analyzed_games:
        cheat_corrs  = [g["white"]["engineCorr"] for g in analyzed_games if g["cheatingWhite"]] + \
                       [g["black"]["engineCorr"] for g in analyzed_games if g["cheatingBlack"]]
        honest_corrs = [g["white"]["engineCorr"] for g in analyzed_games if not g["cheatingWhite"]] + \
                       [g["black"]["engineCorr"] for g in analyzed_games if not g["cheatingBlack"]]

        if cheat_corrs and honest_corrs:
            print(f"\nSummary:")
            print(f"  Avg engine corr — cheating: {sum(cheat_corrs)/len(cheat_corrs):.3f}, honest: {sum(honest_corrs)/len(honest_corrs):.3f}")


if __name__ == "__main__":
    main()
