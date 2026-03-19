import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { socket } from '../socket.js';

const EMPTY_SQUARES = {};

export function useGameSocket(gameId, getBehaviorData) {
  const [gameState, setGameState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [drawOffer, setDrawOffer] = useState(null);
  const [rematchOffer, setRematchOffer] = useState(null);
  const [disconnectTime, setDisconnectTime] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [rematchGameId, setRematchGameId] = useState(null);
  const [moveError, setMoveError] = useState(null);
  const [boardResetKey, setBoardResetKey] = useState(0);
  const [premoveSquares, setPremoveSquares] = useState(EMPTY_SQUARES);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [spectatorChatMessages, setSpectatorChatMessages] = useState([]);
  const [cheerReceived, setCheerReceived] = useState(null);
  const [cheerCooldown, setCheerCooldown] = useState(0);
  const [lastMove, setLastMove] = useState(null);
  const [viewMoveIndex, setViewMoveIndex] = useState(null); // null = live, -1 = start pos, 0+ = half-move

  // Local chess instance for move validation
  const chessRef = useRef(new Chess());

  // Premove queue (ref to avoid stale closures in socket handlers)
  const premoveQueueRef = useRef([]);

  // Track myColor via ref for use in socket handlers
  const myColorRef = useRef(null);

  // Track moves via ref for navigation functions
  const movesRef = useRef([]);

  // For smooth clock interpolation
  const clockRef = useRef({
    whiteTime: 0,
    blackTime: 0,
    turn: 'w',
    lastSync: Date.now(),
  });

  // Helper to rebuild premove highlight styles
  const _updatePremoveHighlights = useCallback(() => {
    const queue = premoveQueueRef.current;
    if (queue.length === 0) {
      setPremoveSquares(EMPTY_SQUARES);
      return;
    }
    const highlights = {};
    queue.forEach((pm) => {
      highlights[pm.from] = { backgroundColor: 'rgba(0, 120, 215, 0.45)' };
      highlights[pm.to] = { backgroundColor: 'rgba(0, 120, 215, 0.45)' };
    });
    setPremoveSquares(highlights);
  }, []);

  useEffect(() => {
    if (!gameId) return;

    // Reset all state when gameId changes (e.g. after rematch)
    setGameState(null);
    setConnected(false);
    setDrawOffer(null);
    setRematchOffer(null);
    setRematchGameId(null);
    setDisconnectTime(null);
    setChatMessages([]);
    setMoveError(null);
    setBoardResetKey(0);
    setPremoveSquares(EMPTY_SQUARES);
    setSpectatorCount(0);
    setSpectatorChatMessages([]);
    setCheerReceived(null);
    setCheerCooldown(0);
    setLastMove(null);
    setViewMoveIndex(null);
    premoveQueueRef.current = [];
    chessRef.current = new Chess();
    myColorRef.current = null;
    movesRef.current = [];

    const joinGame = () => {
      socket.emit('game:join', { gameId });
    };

    const onLobbyGameStart = (data) => {
      if (data.gameId === gameId) {
        socket.emit('game:join', { gameId });
      }
    };

    const onReconnect = () => {
      console.log('[useGameSocket] Socket reconnected, rejoining game');
      joinGame();
    };

    socket.on('lobby:game_start', onLobbyGameStart);
    socket.on('connect', onReconnect);

    if (socket.connected) {
      joinGame();
    } else {
      socket.connect();
    }

    // REST fallback for completed games (e.g. viewing from profile)
    const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    const restFallbackTimer = setTimeout(() => {
      // If we still haven't received state via socket, try REST
      fetch(`${API_URL}/api/leaderboard/game/${encodeURIComponent(gameId)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.game) return;
          // Only apply if we still don't have state
          if (chessRef.current.fen() === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' || !myColorRef.current) {
            const g = data.game;
            if (g.status === 'completed') {
              const restState = {
                gameId: g.id,
                status: g.status,
                fen: g.fen,
                turn: 'w',
                myColor: null, // viewer mode
                whiteName: g.whiteName,
                blackName: g.blackName,
                timeControl: g.timeControl,
                whiteTime: g.whiteTime || 0,
                blackTime: g.blackTime || 0,
                moves: g.moves || [],
                result: g.result,
                reason: g.reason,
                winner: g.result === '1-0' ? 'w' : g.result === '0-1' ? 'b' : null,
                chatMessages: [],
                spectatorChatMessages: [],
                spectatorCount: 0,
                isBotGame: g.isBotGame,
                botPersonality: g.botPersonality,
              };
              chessRef.current.load(g.fen);
              movesRef.current = g.moves || [];
              setGameState(restState);
              setConnected(true);
            }
          }
        })
        .catch(() => {});
    }, 3000);

    const onState = (state) => {
      clearTimeout(restFallbackTimer);
      chessRef.current.load(state.fen);
      myColorRef.current = state.myColor;
      movesRef.current = state.moves || [];

      setGameState(state);
      setChatMessages(state.chatMessages || []);
      setSpectatorChatMessages(state.spectatorChatMessages || []);
      setSpectatorCount(state.spectatorCount || 0);
      setDrawOffer(state.drawOffer || null);
      setConnected(true);
      clockRef.current = {
        whiteTime: state.whiteTime,
        blackTime: state.blackTime,
        turn: state.turn,
        lastSync: Date.now(),
      };
    };

    const onMoveMade = (move) => {
      chessRef.current.load(move.fen);
      setMoveError(null);
      setLastMove(move.from && move.to ? { from: move.from, to: move.to } : null);

      if (move.moves) {
        movesRef.current = move.moves;
      }

      setGameState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          fen: move.fen,
          turn: move.turn,
          whiteTime: move.whiteTime,
          blackTime: move.blackTime,
          moves: move.moves || prev.moves,
        };
      });

      clockRef.current = {
        whiteTime: move.whiteTime,
        blackTime: move.blackTime,
        turn: move.turn,
        lastSync: Date.now(),
      };

      setDrawOffer(null);

      // If it's now our turn and we have premoves, try to execute the first one
      if (move.turn === myColorRef.current && premoveQueueRef.current.length > 0) {
        const next = premoveQueueRef.current[0];
        try {
          const result = chessRef.current.move({
            from: next.from,
            to: next.to,
            promotion: next.promotion || 'q',
          });
          if (result) {
            premoveQueueRef.current.shift();
            const fen = chessRef.current.fen();
            const turn = chessRef.current.turn();
            setGameState((gs) => (gs ? { ...gs, fen, turn } : gs));
            socket.emit('game:move', {
              gameId,
              from: next.from,
              to: next.to,
              promotion: next.promotion,
            });
            _updatePremoveHighlights();
          } else {
            // Illegal premove — cancel all
            premoveQueueRef.current = [];
            setPremoveSquares(EMPTY_SQUARES);
          }
        } catch {
          premoveQueueRef.current = [];
          setPremoveSquares(EMPTY_SQUARES);
        }
      }
    };

    const onClockUpdate = ({ whiteTime, blackTime }) => {
      clockRef.current = {
        ...clockRef.current,
        whiteTime,
        blackTime,
        lastSync: Date.now(),
      };
      setGameState((prev) => {
        if (!prev) return prev;
        return { ...prev, whiteTime, blackTime };
      });
    };

    const onGameOver = (result) => {
      setGameState((prev) =>
        prev ? { ...prev, status: 'completed', ...result } : prev
      );
      // Clear premoves on game end
      premoveQueueRef.current = [];
      setPremoveSquares(EMPTY_SQUARES);
      // Send behavioral data for fair-play analysis
      if (getBehaviorData && myColorRef.current) {
        try {
          const data = getBehaviorData();
          socket.emit('fairplay:behavior', { gameId, data });
        } catch { /* ignore */ }
      }
    };

    const onInvalidMove = ({ message }) => {
      console.warn('[useGameSocket] Move rejected by server:', message);
      setMoveError(message);
      // Clear premoves on invalid move
      premoveQueueRef.current = [];
      setPremoveSquares(EMPTY_SQUARES);
      // Re-sync local chess state
      setGameState((prev) => {
        if (prev) {
          chessRef.current.load(prev.fen);
        }
        return prev ? { ...prev } : prev;
      });
      setBoardResetKey((k) => k + 1);
    };

    const onDrawOffered = ({ offeredBy }) => setDrawOffer(offeredBy);
    const onDrawDeclined = () => setDrawOffer(null);
    const onRematchOffered = ({ offeredBy }) => setRematchOffer(offeredBy);
    const onRematchDeclined = () => setRematchOffer(null);
    const onRematchStart = ({ gameId: newId }) => setRematchGameId(newId);
    const onOpponentDisconnected = ({ timeout }) => {
      setDisconnectTime({ start: Date.now(), timeout: (timeout || 60) * 1000 });
    };
    const onOpponentReconnected = () => setDisconnectTime(null);
    const onChatMessage = (msg) => setChatMessages((prev) => [...prev, msg]);
    const onSpectatorsUpdate = ({ count }) => setSpectatorCount(count);
    const onSpectatorChatMessage = (msg) => setSpectatorChatMessages((prev) => [...prev, msg]);
    const onCheerReceived = (data) => {
      setCheerReceived(data);
      setTimeout(() => setCheerReceived(null), 2500);
    };

    socket.on('game:state', onState);
    socket.on('game:move_made', onMoveMade);
    socket.on('game:clock_update', onClockUpdate);
    socket.on('game:over', onGameOver);
    socket.on('game:invalid_move', onInvalidMove);
    socket.on('game:draw_offered', onDrawOffered);
    socket.on('game:draw_declined', onDrawDeclined);
    socket.on('game:rematch_offered', onRematchOffered);
    socket.on('game:rematch_declined', onRematchDeclined);
    socket.on('game:rematch_start', onRematchStart);
    socket.on('game:opponent_disconnected', onOpponentDisconnected);
    socket.on('game:opponent_reconnected', onOpponentReconnected);
    socket.on('chat:message', onChatMessage);
    socket.on('game:spectators_update', onSpectatorsUpdate);
    socket.on('spectator:chat:message', onSpectatorChatMessage);
    socket.on('game:cheer_received', onCheerReceived);

    return () => {
      clearTimeout(restFallbackTimer);
      // Leave the game room so spectator count updates
      socket.emit('game:leave', { gameId });

      socket.off('lobby:game_start', onLobbyGameStart);
      socket.off('connect', onReconnect);
      socket.off('game:state', onState);
      socket.off('game:move_made', onMoveMade);
      socket.off('game:clock_update', onClockUpdate);
      socket.off('game:over', onGameOver);
      socket.off('game:invalid_move', onInvalidMove);
      socket.off('game:draw_offered', onDrawOffered);
      socket.off('game:draw_declined', onDrawDeclined);
      socket.off('game:rematch_offered', onRematchOffered);
      socket.off('game:rematch_declined', onRematchDeclined);
      socket.off('game:rematch_start', onRematchStart);
      socket.off('game:opponent_disconnected', onOpponentDisconnected);
      socket.off('game:opponent_reconnected', onOpponentReconnected);
      socket.off('chat:message', onChatMessage);
      socket.off('game:spectators_update', onSpectatorsUpdate);
      socket.off('spectator:chat:message', onSpectatorChatMessage);
      socket.off('game:cheer_received', onCheerReceived);
    };
  }, [gameId, _updatePremoveHighlights, getBehaviorData]);

  // Validate move locally and optimistically update gameState
  const tryLocalMove = useCallback((from, to, promotion) => {
    try {
      const move = chessRef.current.move({ from, to, promotion: promotion || 'q' });
      if (move) {
        const fen = chessRef.current.fen();
        const turn = chessRef.current.turn();
        setGameState((prev) => {
          if (!prev) return prev;
          const elapsed = Date.now() - clockRef.current.lastSync;
          const incrementMs = (prev.timeControl?.increment || 0) * 1000;
          const mc = myColorRef.current;
          let wt = clockRef.current.whiteTime;
          let bt = clockRef.current.blackTime;
          if (mc === 'w') {
            wt = Math.max(0, wt - elapsed) + incrementMs;
          } else if (mc === 'b') {
            bt = Math.max(0, bt - elapsed) + incrementMs;
          }
          return { ...prev, fen, turn, whiteTime: wt, blackTime: bt };
        });
        clockRef.current.lastSync = Date.now();
      }
      return move;
    } catch {
      return null;
    }
  }, []);

  const sendMove = useCallback(
    (from, to, promotion) => {
      socket.emit('game:move', { gameId, from, to, promotion });
    },
    [gameId]
  );

  const resign = useCallback(() => {
    socket.emit('game:resign', { gameId });
  }, [gameId]);

  const offerDraw = useCallback(() => {
    socket.emit('game:offer_draw', { gameId });
  }, [gameId]);

  const respondDraw = useCallback(
    (accept) => {
      socket.emit('game:respond_draw', { gameId, accept });
    },
    [gameId]
  );

  const requestRematch = useCallback(() => {
    socket.emit('game:rematch', { gameId });
    setRematchOffer(myColorRef.current);
  }, [gameId]);

  const respondRematch = useCallback(
    (accept) => {
      socket.emit('game:respond_rematch', { gameId, accept });
    },
    [gameId]
  );

  const sendChat = useCallback(
    (message) => {
      socket.emit('chat:send', { gameId, message });
    },
    [gameId]
  );

  const sendSpectatorChat = useCallback(
    (message) => {
      socket.emit('spectator:chat:send', { gameId, message });
    },
    [gameId]
  );

  const sendCheer = useCallback(
    (targetColor) => {
      if (cheerCooldown > 0) return;
      socket.emit('game:cheer', { gameId, targetColor });
      setCheerCooldown(15);
      const interval = setInterval(() => {
        setCheerCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [gameId, cheerCooldown]
  );

  // Premove: queue a move to execute when it becomes our turn
  const addPremove = useCallback(
    (from, to, promotion) => {
      premoveQueueRef.current.push({ from, to, promotion });
      _updatePremoveHighlights();
    },
    [_updatePremoveHighlights]
  );

  const clearPremoves = useCallback(() => {
    premoveQueueRef.current = [];
    setPremoveSquares(EMPTY_SQUARES);
  }, []);

  // --- Move navigation ---

  // Helper: get total half-move count from moves array
  const getTotalHalfMoves = useCallback(() => {
    const moves = movesRef.current;
    if (!moves || moves.length === 0) return 0;
    const lastRow = moves[moves.length - 1];
    const lastBlack = lastRow.black;
    const hasBlack = lastBlack && (typeof lastBlack === 'string' ? lastBlack : lastBlack?.san);
    return (moves.length - 1) * 2 + (hasBlack ? 2 : 1);
  }, []);

  // Helper: get FEN at a given half-move index from moves array
  const getFenAtIndex = useCallback((idx) => {
    if (idx < 0) return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const moves = movesRef.current;
    if (!moves || moves.length === 0) return null;
    const rowIdx = Math.floor(idx / 2);
    const isBlack = idx % 2 === 1;
    const row = moves[rowIdx];
    if (!row) return null;
    const moveData = isBlack ? row.black : row.white;
    if (!moveData) return null;
    // New format: object with fen
    if (typeof moveData === 'object' && moveData.fen) return moveData.fen;
    // Old format (string): reconstruct via chess.js
    return null; // fallback handled below
  }, []);

  const navigateToMove = useCallback((idx) => {
    const total = getTotalHalfMoves();
    if (idx === null || idx >= total) {
      setViewMoveIndex(null);
    } else if (idx < 0) {
      setViewMoveIndex(-1);
    } else {
      setViewMoveIndex(idx);
    }
  }, [getTotalHalfMoves]);

  const navigateFirst = useCallback(() => setViewMoveIndex(-1), []);

  const navigateLast = useCallback(() => setViewMoveIndex(null), []);

  const navigatePrev = useCallback(() => {
    setViewMoveIndex((prev) => {
      if (prev === null) {
        // Currently live — go to last move
        const total = getTotalHalfMoves();
        return total > 0 ? total - 2 : -1;
      }
      return Math.max(-1, prev - 1);
    });
  }, [getTotalHalfMoves]);

  const navigateNext = useCallback(() => {
    setViewMoveIndex((prev) => {
      if (prev === null) return null; // already live
      const total = getTotalHalfMoves();
      const next = prev + 1;
      if (next >= total - 1) return null; // back to live
      return next;
    });
  }, [getTotalHalfMoves]);

  // Compute display FEN based on viewMoveIndex
  const displayFen = (() => {
    if (viewMoveIndex === null) return gameState?.fen || 'start';
    if (viewMoveIndex === -1) return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const fen = getFenAtIndex(viewMoveIndex);
    if (fen) return fen;
    // Fallback for old format: replay through chess.js
    try {
      const replay = new Chess();
      const moves = movesRef.current;
      let count = 0;
      for (const row of moves) {
        const wSan = typeof row.white === 'string' ? row.white : row.white?.san;
        if (wSan) {
          replay.move(wSan);
          if (count === viewMoveIndex) return replay.fen();
          count++;
        }
        const bSan = typeof row.black === 'string' ? row.black : row.black?.san;
        if (bSan) {
          replay.move(bSan);
          if (count === viewMoveIndex) return replay.fen();
          count++;
        }
      }
    } catch { /* ignore */ }
    return gameState?.fen || 'start';
  })();

  const isViewingHistory = viewMoveIndex !== null;

  return {
    gameState,
    connected,
    drawOffer,
    rematchOffer,
    rematchGameId,
    disconnectTime,
    chatMessages,
    clockRef,
    moveError,
    boardResetKey,
    chessRef,
    premoveSquares,
    tryLocalMove,
    sendMove,
    resign,
    offerDraw,
    respondDraw,
    requestRematch,
    respondRematch,
    sendChat,
    sendSpectatorChat,
    addPremove,
    clearPremoves,
    spectatorCount,
    spectatorChatMessages,
    cheerReceived,
    cheerCooldown,
    sendCheer,
    lastMove,
    viewMoveIndex,
    displayFen,
    isViewingHistory,
    navigateToMove,
    navigateFirst,
    navigateLast,
    navigatePrev,
    navigateNext,
  };
}
