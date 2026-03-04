import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameSocket } from '../hooks/useGameSocket.js';
import ChessboardComponent from '../components/chessboard.jsx';
import ChatBox from '../components/chatbox.jsx';
import Timer from '../components/timer.jsx';
import GameOverModal from '../components/GameOverModal.jsx';
import DrawOfferBar from '../components/DrawOfferBar.jsx';

const GamePage = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();

  const {
    gameState,
    connected,
    drawOffer,
    rematchOffer,
    rematchGameId,
    opponentDisconnected,
    chatMessages,
    sendMove,
    resign,
    offerDraw,
    respondDraw,
    requestRematch,
    respondRematch,
    sendChat,
  } = useGameSocket(gameId);

  const [boardSize, setBoardSize] = useState(320);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenBoardSize, setFullscreenBoardSize] = useState(() => {
    if (typeof window === 'undefined') return 480;
    const shorter = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(320, Math.floor(shorter * 0.8));
  });

  // Navigate to rematch game
  useEffect(() => {
    if (rematchGameId) {
      navigate(`/game/${rematchGameId}`, { replace: true });
    }
  }, [rematchGameId, navigate]);

  // Fullscreen board sizing
  useEffect(() => {
    if (!isFullscreen) return;
    const computeSize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const padding = 140;
      const shorter = Math.min(w, h - padding);
      setFullscreenBoardSize(Math.max(320, Math.floor(shorter * 0.95)));
    };
    computeSize();
    window.addEventListener('resize', computeSize);
    return () => window.removeEventListener('resize', computeSize);
  }, [isFullscreen]);

  const handlePieceDrop = useCallback(
    (sourceSquare, targetSquare) => {
      if (!gameState || gameState.status !== 'active') return false;
      if (gameState.turn !== gameState.myColor) return false;
      sendMove(sourceSquare, targetSquare, 'q');
      return true;
    },
    [gameState, sendMove]
  );

  if (!connected || !gameState) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#1e1e1e',
          color: '#f5f5f5',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '18px',
        }}
      >
        Connecting to game...
      </div>
    );
  }

  const isActive = gameState.status === 'active';
  const isCompleted = gameState.status === 'completed';
  const myColor = gameState.myColor;
  const orientation = myColor === 'b' ? 'black' : 'white';

  // Determine which timer is "top" (opponent) and "bottom" (me)
  const myName = myColor === 'w' ? gameState.whiteName : gameState.blackName;
  const opponentName =
    myColor === 'w' ? gameState.blackName : gameState.whiteName;
  const myTime =
    myColor === 'w' ? gameState.whiteTime : gameState.blackTime;
  const opponentTime =
    myColor === 'w' ? gameState.blackTime : gameState.whiteTime;
  const myTurnActive = gameState.turn === myColor && isActive;
  const opponentTurnActive = gameState.turn !== myColor && isActive;

  // Draw offer is for me to respond to
  const showDrawOffer = drawOffer && drawOffer !== myColor;

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
      <h1 style={{ fontSize: '2rem', marginTop: 0, lineHeight: 2.5 }}>
        Chess Wager
      </h1>

      {opponentDisconnected && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: '#e53935',
            borderRadius: '8px',
            marginBottom: '8px',
            fontSize: '14px',
          }}
        >
          Opponent disconnected. They have 60s to reconnect.
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'flex-start',
          gap: '20px',
        }}
      >
        {/* Board column */}
        {!isFullscreen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* Opponent timer (top) */}
            <Timer
              timeMs={opponentTime}
              player={opponentName}
              active={opponentTurnActive}
            />

            <ChessboardComponent
              position={gameState.fen}
              onPieceDrop={handlePieceDrop}
              boardSize={boardSize}
              onBoardSizeChange={setBoardSize}
              boardOrientation={orientation}
            />

            {/* Board controls */}
            <div
              style={{
                marginTop: '8px',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.85rem',
              }}
            >
              <button
                onClick={() => setIsFullscreen(true)}
                style={{
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

            {/* My timer (bottom) */}
            <Timer
              timeMs={myTime}
              player={myName}
              active={myTurnActive}
            />
          </div>
        )}

        {/* Chat + actions column */}
        {!isFullscreen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '8px',
            }}
          >
            <ChatBox
              messages={chatMessages}
              onSend={sendChat}
              moves={gameState.moves}
            />

            {showDrawOffer && (
              <DrawOfferBar
                onAccept={() => respondDraw(true)}
                onDecline={() => respondDraw(false)}
              />
            )}

            {isActive && (
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'space-between',
                }}
              >
                <button
                  onClick={resign}
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
                  onClick={offerDraw}
                  disabled={!!drawOffer}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: drawOffer ? '#444' : '#555',
                    color: '#fff',
                    cursor: drawOffer ? 'default' : 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  {drawOffer === myColor ? 'Draw Offered' : 'Offer Draw'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Game Over Modal */}
      {isCompleted && (
        <GameOverModal
          result={gameState.result}
          reason={gameState.reason}
          winner={gameState.winner}
          myColor={myColor}
          rematchOffer={rematchOffer}
          onRematch={requestRematch}
          onRespondRematch={respondRematch}
          onBackToLobby={() => navigate('/')}
        />
      )}

      {/* FULLSCREEN MODE */}
      {isActive && isFullscreen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#121212',
            zIndex: 950,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Opponent timer top-left */}
          <div style={{ position: 'absolute', top: 24, left: 24 }}>
            <Timer
              timeMs={opponentTime}
              player={opponentName}
              active={opponentTurnActive}
            />
          </div>

          {/* My timer bottom-left */}
          <div style={{ position: 'absolute', bottom: 24, left: 24 }}>
            <Timer
              timeMs={myTime}
              player={myName}
              active={myTurnActive}
            />
          </div>

          <ChessboardComponent
            position={gameState.fen}
            onPieceDrop={handlePieceDrop}
            boardSize={fullscreenBoardSize}
            boardOrientation={orientation}
          />

          {/* Actions bottom-right */}
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
              onClick={resign}
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
              onClick={offerDraw}
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

          {/* Exit fullscreen top-right */}
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

export default GamePage;
