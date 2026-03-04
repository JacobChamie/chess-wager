import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket.js';

export function useGameSocket(gameId) {
  const [gameState, setGameState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [drawOffer, setDrawOffer] = useState(null);
  const [rematchOffer, setRematchOffer] = useState(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [rematchGameId, setRematchGameId] = useState(null);

  // For smooth clock interpolation
  const clockRef = useRef({
    whiteTime: 0,
    blackTime: 0,
    turn: 'w',
    lastSync: Date.now(),
  });

  useEffect(() => {
    if (!gameId) return;

    socket.connect();
    socket.emit('game:join', { gameId });

    // If game:join fails (we're not a player yet), try joining as second player
    const onLobbyError = (data) => {
      if (data.message === 'Not a player in this game') {
        const playerName =
          localStorage.getItem('chess_player_name') || 'Anonymous';
        socket.emit('lobby:join_game', { gameId, playerName });
      }
    };

    // If we successfully joined via lobby, the game:start will fire, then
    // we re-emit game:join to get the full state
    const onLobbyGameStart = (data) => {
      if (data.gameId === gameId) {
        socket.emit('game:join', { gameId });
      }
    };

    socket.on('lobby:error', onLobbyError);
    socket.on('lobby:game_start', onLobbyGameStart);

    const onState = (state) => {
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
      setGameState((prev) => {
        if (!prev) return prev;

        // Update move history
        const moves = [...prev.moves];
        const moveNum = Math.ceil(
          (moves.length === 0
            ? 1
            : move.turn === 'w'
              ? moves[moves.length - 1].moveNumber + 1
              : moves[moves.length - 1].moveNumber)
        );

        if (move.turn === 'b') {
          // White just moved
          if (
            moves.length > 0 &&
            moves[moves.length - 1].moveNumber === moveNum
          ) {
            moves[moves.length - 1] = {
              ...moves[moves.length - 1],
              white: move.san,
            };
          } else {
            moves.push({ moveNumber: moveNum, white: move.san, black: '' });
          }
        } else {
          // Black just moved
          if (
            moves.length > 0 &&
            moves[moves.length - 1].moveNumber === moveNum
          ) {
            moves[moves.length - 1] = {
              ...moves[moves.length - 1],
              black: move.san,
            };
          } else {
            moves.push({ moveNumber: moveNum, white: '', black: move.san });
          }
        }

        return {
          ...prev,
          fen: move.fen,
          turn: move.turn,
          whiteTime: move.whiteTime,
          blackTime: move.blackTime,
          moves,
        };
      });

      clockRef.current = {
        whiteTime: move.whiteTime,
        blackTime: move.blackTime,
        turn: move.turn,
        lastSync: Date.now(),
      };

      setDrawOffer(null);
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
        prev
          ? { ...prev, status: 'completed', ...result }
          : prev
      );
    };

    const onDrawOffered = ({ offeredBy }) => setDrawOffer(offeredBy);
    const onDrawDeclined = () => setDrawOffer(null);
    const onRematchOffered = ({ offeredBy }) => setRematchOffer(offeredBy);
    const onRematchDeclined = () => setRematchOffer(null);
    const onRematchStart = ({ gameId: newId }) => setRematchGameId(newId);
    const onOpponentDisconnected = () => setOpponentDisconnected(true);
    const onOpponentReconnected = () => setOpponentDisconnected(false);
    const onChatMessage = (msg) => setChatMessages((prev) => [...prev, msg]);

    socket.on('game:state', onState);
    socket.on('game:move_made', onMoveMade);
    socket.on('game:clock_update', onClockUpdate);
    socket.on('game:over', onGameOver);
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
      socket.off('game:state', onState);
      socket.off('game:move_made', onMoveMade);
      socket.off('game:clock_update', onClockUpdate);
      socket.off('game:over', onGameOver);
      socket.off('game:draw_offered', onDrawOffered);
      socket.off('game:draw_declined', onDrawDeclined);
      socket.off('game:rematch_offered', onRematchOffered);
      socket.off('game:rematch_declined', onRematchDeclined);
      socket.off('game:rematch_start', onRematchStart);
      socket.off('game:opponent_disconnected', onOpponentDisconnected);
      socket.off('game:opponent_reconnected', onOpponentReconnected);
      socket.off('chat:message', onChatMessage);
    };
  }, [gameId]);

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

  return {
    gameState,
    connected,
    drawOffer,
    rematchOffer,
    rematchGameId,
    opponentDisconnected,
    chatMessages,
    clockRef,
    sendMove,
    resign,
    offerDraw,
    respondDraw,
    requestRematch,
    respondRematch,
    sendChat,
  };
}
