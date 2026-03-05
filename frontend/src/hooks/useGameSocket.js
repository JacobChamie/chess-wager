import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { socket } from '../socket.js';

const EMPTY_SQUARES = {};

export function useGameSocket(gameId) {
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

  // Local chess instance for move validation
  const chessRef = useRef(new Chess());

  // Premove queue (ref to avoid stale closures in socket handlers)
  const premoveQueueRef = useRef([]);

  // Track myColor via ref for use in socket handlers
  const myColorRef = useRef(null);

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

    const joinGame = () => {
      socket.emit('game:join', { gameId });
    };

    const onLobbyError = (data) => {
      if (data.message === 'Not a player in this game') {
        const playerName =
          localStorage.getItem('chess_player_name') || 'Anonymous';
        socket.emit('lobby:join_game', { gameId, playerName });
      }
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

    socket.on('lobby:error', onLobbyError);
    socket.on('lobby:game_start', onLobbyGameStart);
    socket.on('connect', onReconnect);

    if (socket.connected) {
      joinGame();
    } else {
      socket.connect();
    }

    const onState = (state) => {
      chessRef.current.load(state.fen);
      myColorRef.current = state.myColor;

      setGameState(state);
      setChatMessages(state.chatMessages || []);
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
      setGameState((prev) =>
        prev ? { ...prev, whiteTime, blackTime } : prev
      );
    };

    const onGameOver = (result) => {
      setGameState((prev) =>
        prev ? { ...prev, status: 'completed', ...result } : prev
      );
      // Clear premoves on game end
      premoveQueueRef.current = [];
      setPremoveSquares(EMPTY_SQUARES);
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

    return () => {
      socket.off('lobby:error', onLobbyError);
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
    };
  }, [gameId, _updatePremoveHighlights]);

  // Validate move locally and optimistically update gameState
  const tryLocalMove = useCallback((from, to, promotion) => {
    try {
      const move = chessRef.current.move({ from, to, promotion: promotion || 'q' });
      if (move) {
        const fen = chessRef.current.fen();
        const turn = chessRef.current.turn();
        setGameState((prev) => (prev ? { ...prev, fen, turn } : prev));
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
    addPremove,
    clearPremoves,
  };
}
