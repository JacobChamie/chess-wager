// src/App.jsx
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { Chess } from 'chess.js';
import ChessboardComponent from './components/chessboard.jsx';
import ChatBox from './components/chatbox.jsx';
import Timer from './components/timer.jsx';

const App = () => {
  const gameRef = useRef(new Chess());

  const [fen, setFen] = useState(gameRef.current.fen());
  const [gameId, setGameId] = useState(null);
  const [timeControl, setTimeControl] = useState(300);

  const [gameOver, setGameOver] = useState(false);
  const [turn, setTurn] = useState('w'); // 'w' or 'b'
  const [winner, setWinner] = useState(null);
  const [resultReason, setResultReason] = useState(null);

  const [score, setScore] = useState({ white: 0, black: 0 }); // incremental scoring
  const [moves, setMoves] = useState([]); // [{ moveNumber, white, black }]

  const [boardSize, setBoardSize] = useState(320);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenBoardSize, setFullscreenBoardSize] = useState(() => {
    if (typeof window === 'undefined') return 480;
    const shorter = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(320, Math.floor(shorter * 0.8));
  });

  const getPlayerNameFromColor = (color) =>
    color === 'w' ? 'Player 1 (White)' : 'Player 2 (Black)';

  const updateScore = (winnerColor, resultType) => {
    setScore((prev) => {
      let { white, black } = prev;

      if (resultType === 'win') {
        if (winnerColor === 'w') white += 1;
        if (winnerColor === 'b') black += 1;
      } else if (resultType === 'draw') {
        white += 0.5;
        black += 0.5;
      }

      return { white, black };
    });
  };

  const resetGameState = () => {
    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setGameId(Date.now());
    setGameOver(false);
    setTurn('w');
    setWinner(null);
    setResultReason(null);
    setMoves([]);
    setIsFullscreen(false);
  };

  const createNewGame = () => {
    resetGameState();
  };

  const handleTimeout = (player) => {
    if (gameOver) return;

    const winnerColor = player === 'w' ? 'b' : 'w';
    const winnerName = getPlayerNameFromColor(winnerColor);

    updateScore(winnerColor, 'win');
    setGameOver(true);
    setWinner(winnerName);
    setResultReason('timeout');
    setIsFullscreen(false);
  };

  const handlePieceDrop = useCallback(
    (sourceSquare, targetSquare, piece) => {
      if (gameOver) return false;

      const game = gameRef.current;

      const fromPiece = game.get(sourceSquare);
      if (!fromPiece || fromPiece.color !== game.turn()) {
        return false;
      }

      const move = game.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });

      if (!move) {
        return false;
      }

      // Update board / turn
      setFen(game.fen());
      setTurn(game.turn());

      // Build move list
      const verboseHistory = game.history({ verbose: true });
      const rows = [];
      for (let i = 0; i < verboseHistory.length; i += 2) {
        rows.push({
          moveNumber: i / 2 + 1,
          white: verboseHistory[i]?.san || '',
          black: verboseHistory[i + 1]?.san || '',
        });
      }
      setMoves(rows);

      // Detect game result
      if (game.isGameOver()) {
        let reason = null;
        let winnerName = null;

        if (game.isCheckmate()) {
          reason = 'checkmate';
          const loser = game.turn(); // side to move after checkmate is the loser
          const winnerColor = loser === 'w' ? 'b' : 'w';
          winnerName = getPlayerNameFromColor(winnerColor);
          updateScore(winnerColor, 'win');
        } else if (game.isStalemate()) {
          reason = 'stalemate';
          updateScore(null, 'draw');
        } else if (game.isThreefoldRepetition()) {
          reason = 'threefold repetition';
          updateScore(null, 'draw');
        } else if (game.isInsufficientMaterial()) {
          reason = 'insufficient material';
          updateScore(null, 'draw');
        } else if (game.isDraw()) {
          reason = 'draw';
          updateScore(null, 'draw');
        } else {
          reason = 'game over';
        }

        setGameOver(true);
        setWinner(winnerName);
        setResultReason(reason);
        setIsFullscreen(false);
      }

      return true;
    },
    [gameOver]
  );

  // RESIGN: current player resigns, opponent gets a win
  const handleResign = () => {
    if (gameOver || !gameId) return;
    const loser = gameRef.current.turn();
    const winnerColor = loser === 'w' ? 'b' : 'w';
    const winnerName = getPlayerNameFromColor(winnerColor);

    updateScore(winnerColor, 'win');
    setGameOver(true);
    setWinner(winnerName);
    setResultReason('resign');
    setIsFullscreen(false);
  };

  // OFFER DRAW: auto-accept as draw
  const handleOfferDraw = () => {
    if (gameOver || !gameId) return;

    updateScore(null, 'draw');
    setGameOver(true);
    setWinner(null);
    setResultReason('draw');
    setIsFullscreen(false);
  };

  const renderResultText = () => {
    if (!resultReason) return 'Game Over';

    const map = {
      checkmate: 'Checkmate',
      stalemate: 'Stalemate',
      'threefold repetition': 'Draw by threefold repetition',
      'insufficient material': 'Draw by insufficient material',
      draw: 'Draw',
      timeout: 'Win on time',
      resign: 'Win by resignation',
      'game over': 'Game Over',
    };

    return map[resultReason] || 'Game Over';
  };

  // When we go fullscreen, compute a board size that fills the viewport nicely
  useEffect(() => {
    if (!isFullscreen) return;

    const computeSize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      // leave some room for timers + buttons at edges
      const padding = 140; // total top+bottom margin space
      const shorter = Math.min(w, h - padding);

      const size = Math.max(320, Math.floor(shorter * 0.95));
      setFullscreenBoardSize(size);
    };

    computeSize();
    window.addEventListener('resize', computeSize);
    return () => window.removeEventListener('resize', computeSize);
  }, [isFullscreen]);


  const enterFullscreen = () => {
    setIsFullscreen(true);
  };

  return (
    <div
      style={{
        textAlign: 'center',
        backgroundColor: '#1e1e1e',
        minHeight: '100vh',
        color: '#f5f5f5',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '8px',
        position: 'relative',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', marginTop: 0, lineHeight: 3 }}>
        Chess Game
      </h1>

      {/* Top controls + match score */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <button
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: '#4caf50',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
          onClick={createNewGame}
        >
          New Game
        </button>

        <input
          type="number"
          placeholder="Time (seconds)"
          value={timeControl}
          onChange={(e) => setTimeControl(Number(e.target.value) || 0)}
          style={{
            padding: '10px',
            fontSize: '16px',
            border: '1px solid',
            borderRadius: '8px',
            width: '160px',
            textAlign: 'center',
          }}
        />

        <div
          style={{
            marginLeft: '16px',
            fontSize: '0.95rem',
            padding: '6px 10px',
            borderRadius: '8px',
            backgroundColor: '#2a2a2a',
          }}
        >
          Score — White: {score.white} · Black: {score.black}
        </div>
      </div>

      {gameId && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'flex-start',
            gap: '20px',
          }}
        >
          {/* Board column (normal view) */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
            }}
          >
            {/* Top (opponent) timer */}
            {!isFullscreen && (
              <Timer
                key={`${gameId}-black`}
                timeControl={timeControl}
                player="Player 2 (Black)"
                score={score.black}
                active={turn === 'b' && !gameOver}
                onTimeout={() => handleTimeout('b')}
              />
            )}

            {!isFullscreen && (
              <ChessboardComponent
                position={fen}
                onPieceDrop={handlePieceDrop}
                boardSize={boardSize}
                onBoardSizeChange={setBoardSize} // resizable only here
              />
            )}

            {/* Board controls under board */}
            {!isFullscreen && (
              <div
                style={{
                  marginTop: '8px',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  color: '#ccc',
                }}
              >
                <button
                  onClick={enterFullscreen}
                  style={{
                    marginLeft: '8px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#4caf50',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Full board
                </button>
              </div>
            )}

            {/* Bottom (you) timer */}
            {!isFullscreen && (
              <Timer
                key={`${gameId}-white`}
                timeControl={timeControl}
                player="Player 1 (White)"
                score={score.white}
                active={turn === 'w' && !gameOver}
                onTimeout={() => handleTimeout('w')}
              />
            )}
          </div>

          {/* Chat + action buttons column */}
          {!isFullscreen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: '8px',
              }}
            >
              <ChatBox userId="User4" moves={moves} />

              {/* Resign / Offer draw under chat */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'space-between',
                }}
              >
                <button
                  onClick={handleResign}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#e53935',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  Resign
                </button>
                <button
                  onClick={handleOfferDraw}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#555',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  Offer Draw
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Result popup */}
      {gameId && gameOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 900,
          }}
        >
          <div
            style={{
              backgroundColor: '#2a2a2a',
              padding: '24px 32px',
              borderRadius: '12px',
              boxShadow: '0 0 20px rgba(0,0,0,0.7)',
              minWidth: '280px',
              textAlign: 'center',
            }}
          >
            <h2 style={{ marginBottom: '12px', fontSize: '1.8rem' }}>
              {renderResultText()}
            </h2>

            {winner ? (
              <p style={{ marginBottom: '16px', fontSize: '1.1rem' }}>
                Winner: <strong>{winner}</strong>
              </p>
            ) : (
              <p style={{ marginBottom: '16px', fontSize: '1.1rem' }}>
                The game ended in a draw.
              </p>
            )}

            <p style={{ marginBottom: '16px', fontSize: '0.95rem' }}>
              Match score — White: {score.white} · Black: {score.black}
            </p>

            <button
              style={{
                marginTop: '8px',
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4caf50',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              onClick={createNewGame}
            >
              Rematch
            </button>
          </div>
        </div>
      )}

      {/* FULLSCREEN BOARD MODE (no scroll, no resize) */}
      {gameId && !gameOver && isFullscreen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#121212',
            zIndex: 950,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden', // no scrolling in fullscreen
          }}
        >
          {/* Opponent (Black) top-left */}
          <div style={{ position: 'absolute', top: 24, left: 24 }}>
            <Timer
              key={`${gameId}-black-full`}
              timeControl={timeControl}
              player="Player 2 (Black)"
              score={score.black}
              active={turn === 'b' && !gameOver}
              onTimeout={() => handleTimeout('b')}
            />
          </div>

          {/* You (White) bottom-left */}
          <div style={{ position: 'absolute', bottom: 24, left: 24 }}>
            <Timer
              key={`${gameId}-white-full`}
              timeControl={timeControl}
              player="Player 1 (White)"
              score={score.white}
              active={turn === 'w' && !gameOver}
              onTimeout={() => handleTimeout('w')}
            />
          </div>

          {/* Board centered, fixed size derived from viewport */}
          <ChessboardComponent
            position={fen}
            onPieceDrop={handlePieceDrop}
            boardSize={fullscreenBoardSize}
            // NOTE: no onBoardSizeChange here -> not resizable
          />

          {/* Action buttons bottom-right */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              right: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              alignItems: 'flex-end',
            }}
          >
            <button
              onClick={handleResign}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#e53935',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Resign
            </button>
            <button
              onClick={handleOfferDraw}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#555',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Offer Draw
            </button>
          </div>

          {/* Exit full board top-right */}
          <div style={{ position: 'absolute', top: 24, right: 24 }}>
            <button
              onClick={() => setIsFullscreen(false)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#333',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.9rem',
              }}
            >
              Exit full board
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
