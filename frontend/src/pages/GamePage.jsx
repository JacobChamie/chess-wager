import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameSocket } from '../hooks/useGameSocket.js';
import ChessboardComponent from '../components/chessboard.jsx';
import ChatBox from '../components/chatbox.jsx';
import Timer from '../components/timer.jsx';
import GameOverModal from '../components/GameOverModal.jsx';
import DrawOfferBar from '../components/DrawOfferBar.jsx';
import PromotionPicker from '../components/PromotionPicker.jsx';
import ConfettiOverlay from '../components/ConfettiOverlay.jsx';

// Live countdown banner for opponent disconnect
const DisconnectBanner = ({ disconnectTime }) => {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const elapsed = Date.now() - disconnectTime.start;
    return Math.max(0, Math.ceil((disconnectTime.timeout - elapsed) / 1000));
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - disconnectTime.start;
      const remaining = Math.max(0, Math.ceil((disconnectTime.timeout - elapsed) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 200);
    return () => clearInterval(interval);
  }, [disconnectTime]);

  return (
    <div className="disconnect-banner">
      Opponent disconnected — {secondsLeft}s to reconnect
    </div>
  );
};

const GamePage = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();

  const {
    gameState,
    connected,
    drawOffer,
    rematchOffer,
    rematchGameId,
    disconnectTime,
    chatMessages,
    moveError,
    boardResetKey,
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
  } = useGameSocket(gameId);

  const [boardSize, setBoardSize] = useState(() => {
    if (typeof window === 'undefined') return 320;
    const maxByWidth = Math.floor(window.innerWidth * 0.9) - 40;
    // Reserve ~200px for timers, buttons, padding, navbar
    const maxByHeight = Math.floor(window.innerHeight - 52 - 200);
    return Math.min(480, Math.max(240, Math.min(maxByWidth, maxByHeight)));
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenBoardSize, setFullscreenBoardSize] = useState(() => {
    if (typeof window === 'undefined') return 480;
    const shorter = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(320, Math.floor(shorter * 0.8));
  });

  const [pendingPromotion, setPendingPromotion] = useState(null);

  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    if (rematchGameId) {
      navigate(`/game/${rematchGameId}`, { replace: true });
    }
  }, [rematchGameId, navigate]);

  useEffect(() => {
    if (!isFullscreen) return;
    const computeSize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const shorter = Math.min(w, h - 140);
      setFullscreenBoardSize(Math.max(320, Math.floor(shorter * 0.95)));
    };
    computeSize();
    window.addEventListener('resize', computeSize);
    return () => window.removeEventListener('resize', computeSize);
  }, [isFullscreen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') clearPremoves();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearPremoves]);

  const handlePieceDrop = useCallback(
    (sourceSquare, targetSquare, piece) => {
      const gs = gameStateRef.current;
      if (!gs || gs.status !== 'active') return false;
      if (gs.myColor === null) return false; // spectator

      if (gs.turn !== gs.myColor) {
        const isPawn = piece?.[1] === 'P' || piece?.[1] === 'p';
        const isPromoRank =
          (gs.myColor === 'w' && targetSquare[1] === '8') ||
          (gs.myColor === 'b' && targetSquare[1] === '1');
        const promotion = isPawn && isPromoRank ? 'q' : undefined;
        addPremove(sourceSquare, targetSquare, promotion);
        return false;
      }

      const isPawn = piece?.[1] === 'P' || piece?.[1] === 'p';
      const isPromoRank =
        (gs.myColor === 'w' && targetSquare[1] === '8') ||
        (gs.myColor === 'b' && targetSquare[1] === '1');

      if (isPawn && isPromoRank) {
        setPendingPromotion({ from: sourceSquare, to: targetSquare });
        return false;
      }

      const localMove = tryLocalMove(sourceSquare, targetSquare);
      if (!localMove) return false;

      sendMove(sourceSquare, targetSquare);
      return true;
    },
    [tryLocalMove, sendMove, addPremove]
  );

  const handlePromotionChoice = useCallback(
    (piece) => {
      if (!pendingPromotion) return;
      const { from, to } = pendingPromotion;
      setPendingPromotion(null);
      const localMove = tryLocalMove(from, to, piece);
      if (!localMove) return;
      sendMove(from, to, piece);
    },
    [pendingPromotion, tryLocalMove, sendMove]
  );

  const handlePromotionCancel = useCallback(() => {
    setPendingPromotion(null);
  }, []);

  const handleSquareRightClick = useCallback(() => {
    clearPremoves();
  }, [clearPremoves]);

  if (!connected || !gameState) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-base)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
          Connecting to game...
        </p>
      </div>
    );
  }

  const isActive = gameState.status === 'active';
  const isCompleted = gameState.status === 'completed';
  const myColor = gameState.myColor;
  const isSpectator = myColor === null;
  const orientation = myColor === 'b' ? 'black' : 'white'; // spectators see white at bottom

  // For spectators: top = black, bottom = white
  const topName = isSpectator ? gameState.blackName : (myColor === 'w' ? gameState.blackName : gameState.whiteName);
  const bottomName = isSpectator ? gameState.whiteName : (myColor === 'w' ? gameState.whiteName : gameState.blackName);
  const topTime = isSpectator ? gameState.blackTime : (myColor === 'w' ? gameState.blackTime : gameState.whiteTime);
  const bottomTime = isSpectator ? gameState.whiteTime : (myColor === 'w' ? gameState.whiteTime : gameState.blackTime);
  const topColor = isSpectator ? 'b' : (myColor === 'w' ? 'b' : 'w');
  const bottomColor = isSpectator ? 'w' : myColor;
  const topTurnActive = gameState.turn === topColor && isActive;
  const bottomTurnActive = gameState.turn === bottomColor && isActive;

  // Backwards compat aliases
  const myName = bottomName;
  const opponentName = topName;
  const myTime = bottomTime;
  const opponentTime = topTime;
  const myTurnActive = bottomTurnActive;
  const opponentTurnActive = topTurnActive;

  const showDrawOffer = !isSpectator && drawOffer && drawOffer !== myColor;

  return (
    <div
      style={{
        textAlign: 'center',
        background: 'var(--bg-base)',
        height: 'calc(100vh - 52px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '12px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {cheerReceived && <ConfettiOverlay targetColor={cheerReceived.targetColor} />}

      {disconnectTime && <DisconnectBanner disconnectTime={disconnectTime} />}

      {moveError && (
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(255, 152, 0, 0.12)',
            border: '1px solid rgba(255, 152, 0, 0.3)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '8px',
            fontSize: '13px',
            color: '#ffa726',
          }}
        >
          Move rejected: {moveError}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'stretch',
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
              position: 'relative',
            }}
          >
            <Timer
              timeMs={opponentTime}
              player={opponentName}
              active={opponentTurnActive}
            />

            <ChessboardComponent
              key={boardResetKey}
              position={gameState.fen}
              onPieceDrop={handlePieceDrop}
              boardSize={boardSize}
              onBoardSizeChange={setBoardSize}
              boardOrientation={orientation}
              premoveSquares={premoveSquares}
              onSquareRightClick={handleSquareRightClick}
            />

            {pendingPromotion && (
              <PromotionPicker
                color={myColor}
                onSelect={handlePromotionChoice}
                onCancel={handlePromotionCancel}
              />
            )}

            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setIsFullscreen(true)}
              style={{ marginTop: '8px', fontSize: '12px' }}
            >
              Full board
            </button>

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
              width: '340px',
              flexShrink: 0,
            }}
          >
            {spectatorCount > 0 && (
              <div className="spectator-badge" style={{ alignSelf: 'flex-start', marginBottom: '4px' }}>
                {'\uD83D\uDC41'} {spectatorCount} watching
              </div>
            )}

            <ChatBox
              messages={chatMessages}
              onSend={sendChat}
              moves={gameState.moves}
              myName={myName}
              isSpectator={isSpectator}
              spectatorMessages={spectatorChatMessages}
              onSpectatorSend={sendSpectatorChat}
            />

            {showDrawOffer && (
              <DrawOfferBar
                onAccept={() => respondDraw(true)}
                onDecline={() => respondDraw(false)}
              />
            )}

            {isActive && !isSpectator && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-danger"
                  onClick={resign}
                  style={{ flex: 1 }}
                >
                  Resign
                </button>
                <button
                  className={`btn btn-ghost${drawOffer ? '' : ''}`}
                  onClick={offerDraw}
                  disabled={!!drawOffer}
                  style={{ flex: 1 }}
                >
                  {drawOffer === myColor ? 'Draw Offered' : 'Offer Draw'}
                </button>
              </div>
            )}

            {isActive && isSpectator && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-sm"
                  style={{ flex: 1, background: '#1565c0', color: '#fff', borderColor: '#1565c0' }}
                  onClick={() => sendCheer('w')}
                  disabled={cheerCooldown > 0 || gameState.whiteTime < 30000 || gameState.blackTime < 30000}
                >
                  {cheerCooldown > 0 ? `${cheerCooldown}s` : 'Cheer White'}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ flex: 1, background: '#c62828', color: '#fff', borderColor: '#c62828' }}
                  onClick={() => sendCheer('b')}
                  disabled={cheerCooldown > 0 || gameState.whiteTime < 30000 || gameState.blackTime < 30000}
                >
                  {cheerCooldown > 0 ? `${cheerCooldown}s` : 'Cheer Black'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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

      {isActive && isFullscreen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-base)',
            zIndex: 950,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: 24, left: 24 }}>
            <Timer
              timeMs={opponentTime}
              player={opponentName}
              active={opponentTurnActive}
            />
          </div>

          <div style={{ position: 'absolute', bottom: 24, left: 24 }}>
            <Timer
              timeMs={myTime}
              player={myName}
              active={myTurnActive}
            />
          </div>

          <ChessboardComponent
            key={`fs-${boardResetKey}`}
            position={gameState.fen}
            onPieceDrop={handlePieceDrop}
            boardSize={fullscreenBoardSize}
            boardOrientation={orientation}
            premoveSquares={premoveSquares}
            onSquareRightClick={handleSquareRightClick}
          />

          {pendingPromotion && (
            <div style={{ position: 'absolute', zIndex: 1000 }}>
              <PromotionPicker
                color={myColor}
                onSelect={handlePromotionChoice}
                onCancel={handlePromotionCancel}
              />
            </div>
          )}

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
            <button className="btn btn-danger" onClick={resign}>
              Resign
            </button>
            <button className="btn btn-ghost" onClick={offerDraw}>
              Offer Draw
            </button>
          </div>

          <div style={{ position: 'absolute', top: 24, right: 24 }}>
            <button
              className="btn btn-ghost"
              onClick={() => setIsFullscreen(false)}
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
