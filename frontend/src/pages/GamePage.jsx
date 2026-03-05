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
    chessRef,
    lastMove,
    viewMoveIndex,
    displayFen,
    isViewingHistory,
    navigateToMove,
    navigateFirst,
    navigateLast,
    navigatePrev,
    navigateNext,
  } = useGameSocket(gameId);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  const [chatExpanded, setChatExpanded] = useState(false);

  const computeBoardSize = useCallback(() => {
    if (typeof window === 'undefined') return 320;
    const mobile = window.innerWidth < 640;
    if (mobile) {
      // Fill width minus padding
      return Math.min(window.innerWidth - 16, window.innerHeight - 280);
    }
    const maxByWidth = Math.floor(window.innerWidth * 0.9) - 40;
    const maxByHeight = Math.floor(window.innerHeight - 52 - 200);
    return Math.min(480, Math.max(240, Math.min(maxByWidth, maxByHeight)));
  }, []);

  const [boardSize, setBoardSize] = useState(computeBoardSize);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenBoardSize, setFullscreenBoardSize] = useState(() => {
    if (typeof window === 'undefined') return 480;
    const shorter = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(320, Math.floor(shorter * 0.8));
  });

  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [modalDismissed, setModalDismissed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Track viewport changes for responsive layout
  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      setBoardSize(computeBoardSize());
      const shorter = Math.min(window.innerWidth, window.innerHeight);
      setFullscreenBoardSize(Math.max(320, Math.floor(shorter * 0.8)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [computeBoardSize]);

  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const handleClickMoveRef = useRef(null);

  useEffect(() => {
    setModalDismissed(false);
  }, [gameId]);

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
      // Skip arrow nav if user is typing
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          navigatePrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          navigateNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          navigateFirst();
          break;
        case 'ArrowDown':
          e.preventDefault();
          navigateLast();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearPremoves, navigatePrev, navigateNext, navigateFirst, navigateLast]);

  const handlePieceDrop = useCallback(
    (sourceSquare, targetSquare, piece) => {
      // Same-square drop = tap/click on mobile touch
      if (sourceSquare === targetSquare) {
        handleClickMoveRef.current?.(sourceSquare);
        return false;
      }

      // Block interaction when viewing history
      if (isViewingHistory) return false;

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
      setSelectedSquare(null);
      return true;
    },
    [tryLocalMove, sendMove, addPremove, isViewingHistory]
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

  // Core click-to-move logic — used by both onSquareClick and onPieceClick
  const handleClickMove = useCallback(
    (square) => {
      const gs = gameStateRef.current;
      if (!gs || gs.status !== 'active') return;
      if (gs.myColor === null) return; // spectator

      // Cancel premoves on any board click
      if (Object.keys(premoveSquares).length > 0) {
        clearPremoves();
        return;
      }

      const chess = chessRef.current;
      if (!chess) return;
      const piece = chess.get(square);
      const isMyTurn = gs.turn === gs.myColor;

      if (selectedSquare) {
        // Already have a piece selected — try to move there
        if (square === selectedSquare) {
          // Clicked same square — deselect
          setSelectedSquare(null);
          return;
        }

        // If it's our own piece, re-select it
        if (piece && piece.color === gs.myColor) {
          setSelectedSquare(square);
          return;
        }

        if (isMyTurn) {
          // Check if this is a legal move from selectedSquare to square
          const legalMoves = chess.moves({ square: selectedSquare, verbose: true });
          const matchingMove = legalMoves.find(m => m.to === square);

          if (matchingMove) {
            // Check for promotion
            const srcPiece = chess.get(selectedSquare);
            const isPawn = srcPiece?.type === 'p';
            const isPromoRank =
              (gs.myColor === 'w' && square[1] === '8') ||
              (gs.myColor === 'b' && square[1] === '1');

            if (isPawn && isPromoRank) {
              setPendingPromotion({ from: selectedSquare, to: square });
              setSelectedSquare(null);
              return;
            }

            // Make the move
            const localMove = tryLocalMove(selectedSquare, square);
            if (localMove) {
              sendMove(selectedSquare, square);
            }
            setSelectedSquare(null);
            return;
          }

          // Illegal square — deselect
          setSelectedSquare(null);
          return;
        } else {
          // Not our turn — queue as premove
          const srcPiece = chess.get(selectedSquare);
          const isPawn = srcPiece?.type === 'p';
          const isPromoRank =
            (gs.myColor === 'w' && square[1] === '8') ||
            (gs.myColor === 'b' && square[1] === '1');
          const promotion = isPawn && isPromoRank ? 'q' : undefined;
          addPremove(selectedSquare, square, promotion);
          setSelectedSquare(null);
          return;
        }
      }

      // No selection yet — select if it's our piece
      if (piece && piece.color === gs.myColor) {
        setSelectedSquare(square);
      }
    },
    [selectedSquare, chessRef, tryLocalMove, sendMove, addPremove, premoveSquares, clearPremoves]
  );

  // Keep ref in sync for handlePieceDrop same-square-drop routing
  handleClickMoveRef.current = handleClickMove;

  // onSquareClick — fires when clicking empty squares (or squares without draggable pieces)
  const handleSquareClick = useCallback(
    (square) => handleClickMove(square),
    [handleClickMove]
  );

  // onPieceClick — fires when clicking on a piece (react-chessboard calls this separately from onSquareClick)
  const handlePieceClick = useCallback(
    (piece, square) => handleClickMove(square),
    [handleClickMove]
  );

  // Clear selection only when game ends (not on every FEN change)
  useEffect(() => {
    setSelectedSquare(null);
  }, [gameState?.status]);

  const handleSquareRightClick = useCallback(() => {
    setSelectedSquare(null);
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

  // Compute result icons for timers
  let topResultIcon = null;
  let bottomResultIcon = null;
  if (isCompleted) {
    const winner = gameState.winner;
    if (winner === null) {
      // Draw
      topResultIcon = 'draw';
      bottomResultIcon = 'draw';
    } else {
      topResultIcon = winner === topColor ? 'win' : 'loss';
      bottomResultIcon = winner === bottomColor ? 'win' : 'loss';
    }
  }

  const showDrawOffer = !isSpectator && drawOffer && drawOffer !== myColor;

  // Merge last-move + premove + click-to-move highlights
  const mergedSquareStyles = { ...premoveSquares };
  if (lastMove) {
    mergedSquareStyles[lastMove.from] = {
      backgroundColor: 'rgba(255, 255, 0, 0.2)',
      ...(mergedSquareStyles[lastMove.from] || {}),
    };
    mergedSquareStyles[lastMove.to] = {
      backgroundColor: 'rgba(255, 255, 0, 0.25)',
      ...(mergedSquareStyles[lastMove.to] || {}),
    };
  }
  if (selectedSquare && chessRef.current) {
    mergedSquareStyles[selectedSquare] = {
      backgroundColor: 'rgba(255, 255, 0, 0.4)',
      ...(mergedSquareStyles[selectedSquare] || {}),
    };
    const legalMoves = chessRef.current.moves({ square: selectedSquare, verbose: true });
    for (const m of legalMoves) {
      const existing = mergedSquareStyles[m.to] || {};
      // Capture vs empty square — different dot styles
      if (m.captured) {
        mergedSquareStyles[m.to] = {
          background: 'radial-gradient(circle, transparent 55%, rgba(0,0,0,0.25) 56%)',
          borderRadius: '50%',
          ...existing,
        };
      } else {
        mergedSquareStyles[m.to] = {
          background: 'radial-gradient(circle, rgba(0,0,0,0.2) 20%, transparent 21%)',
          ...existing,
        };
      }
    }
  }

  return (
    <div
      style={{
        textAlign: 'center',
        background: 'var(--bg-base)',
        minHeight: 'calc(100vh - 52px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '12px',
        position: 'relative',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {cheerReceived && <ConfettiOverlay targetColor={cheerReceived.targetColor} />}

      {disconnectTime && !gameState?.isBotGame && <DisconnectBanner disconnectTime={disconnectTime} />}

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
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'center',
          alignItems: isMobile ? 'center' : 'stretch',
          gap: isMobile ? '4px' : '20px',
          flex: 1,
          minHeight: 0,
          overflow: 'visible',
          width: isMobile ? '100%' : undefined,
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
              resultIcon={topResultIcon}
            />

            <ChessboardComponent
              key={boardResetKey}
              position={displayFen}
              onPieceDrop={handlePieceDrop}
              boardSize={boardSize}
              onBoardSizeChange={isMobile ? undefined : setBoardSize}
              boardOrientation={orientation}
              premoveSquares={isViewingHistory ? {} : mergedSquareStyles}
              onSquareClick={isViewingHistory ? undefined : handleSquareClick}
              onPieceClick={isViewingHistory ? undefined : handlePieceClick}
              onSquareRightClick={handleSquareRightClick}
            />

            {pendingPromotion && (
              <PromotionPicker
                color={myColor}
                onSelect={handlePromotionChoice}
                onCancel={handlePromotionCancel}
              />
            )}

            {/* Move navigation buttons */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px', justifyContent: 'center', alignItems: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={navigateFirst} title="First move" style={{ padding: '4px 8px', fontSize: '14px', minWidth: '36px' }}>
                {'|<'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={navigatePrev} title="Previous move" style={{ padding: '4px 8px', fontSize: '14px', minWidth: '36px' }}>
                {'<'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={navigateNext} title="Next move" style={{ padding: '4px 8px', fontSize: '14px', minWidth: '36px' }}>
                {'>'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={navigateLast} title="Last move (live)" style={{ padding: '4px 8px', fontSize: '14px', minWidth: '36px' }}>
                {'>|'}
              </button>
            </div>

            {isViewingHistory && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px',
                padding: '4px 12px', background: 'rgba(255,152,0,0.12)', borderRadius: 'var(--radius-sm)',
                fontSize: '13px', color: '#ffa726',
              }}>
                <span>Viewing move {viewMoveIndex === -1 ? 'start' : viewMoveIndex + 1}</span>
                <button className="btn btn-ghost btn-sm" onClick={navigateLast} style={{ fontSize: '12px', padding: '2px 8px' }}>
                  Return to live
                </button>
              </div>
            )}

            {!isMobile && !isViewingHistory && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setIsFullscreen(true)}
                style={{ marginTop: '4px', fontSize: '12px' }}
              >
                Full board
              </button>
            )}

            <Timer
              timeMs={myTime}
              player={myName}
              active={myTurnActive}
              resultIcon={bottomResultIcon}
            />

            {/* Mobile action buttons inline */}
            {isMobile && isActive && !isSpectator && (
              <div style={{ display: 'flex', gap: '8px', width: '100%', padding: '0 8px', marginTop: '4px' }}>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={resign}
                  style={{ flex: 1 }}
                >
                  Resign
                </button>
                {!gameState?.isBotGame && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={offerDraw}
                    disabled={!!drawOffer}
                    style={{ flex: 1 }}
                  >
                    {drawOffer === myColor ? 'Draw Offered' : 'Offer Draw'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat + actions column — collapsible on mobile */}
        {!isFullscreen && isMobile && (
          <div style={{ width: '100%', padding: '0 8px' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setChatExpanded((v) => !v)}
              style={{
                width: '100%',
                fontSize: '12px',
                padding: '6px',
                marginTop: '4px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {chatExpanded ? '\u25B2 Hide' : '\u25BC Chat & Moves'}
              {spectatorCount > 0 && ` \u00B7 ${spectatorCount} watching`}
            </button>
            {chatExpanded && (
              <div style={{ marginTop: '4px' }}>
                <ChatBox
                  messages={chatMessages}
                  onSend={sendChat}
                  moves={gameState.moves}
                  myName={myName}
                  isSpectator={isSpectator}
                  spectatorMessages={spectatorChatMessages}
                  onSpectatorSend={sendSpectatorChat}
                  gameStatus={gameState.status}
                  gameResult={gameState.result}
                  gameReason={gameState.reason}
                  onMoveClick={navigateToMove}
                  viewMoveIndex={viewMoveIndex}
                />
              </div>
            )}
          </div>
        )}

        {/* Desktop sidebar toggle when hidden */}
        {!isFullscreen && !isMobile && !sidebarOpen && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSidebarOpen(true)}
            style={{ alignSelf: 'flex-start', marginTop: '8px', fontSize: '12px' }}
            title="Show panel"
          >
            {'\u25C0'} Panel
          </button>
        )}

        {/* Desktop chat + actions */}
        {!isFullscreen && !isMobile && sidebarOpen && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '8px',
              width: '340px',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              {spectatorCount > 0 ? (
                <div className="spectator-badge">
                  {'\uD83D\uDC41'} {spectatorCount} watching
                </div>
              ) : <div />}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSidebarOpen(false)}
                style={{ fontSize: '11px', padding: '4px 8px' }}
                title="Hide panel"
              >
                {'\u2715'}
              </button>
            </div>

            <ChatBox
              messages={chatMessages}
              onSend={sendChat}
              moves={gameState.moves}
              myName={myName}
              isSpectator={isSpectator}
              spectatorMessages={spectatorChatMessages}
              onSpectatorSend={sendSpectatorChat}
              gameStatus={gameState.status}
              gameResult={gameState.result}
              gameReason={gameState.reason}
              onMoveClick={navigateToMove}
              viewMoveIndex={viewMoveIndex}
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
                {!gameState?.isBotGame && (
                  <button
                    className={`btn btn-ghost${drawOffer ? '' : ''}`}
                    onClick={offerDraw}
                    disabled={!!drawOffer}
                    style={{ flex: 1 }}
                  >
                    {drawOffer === myColor ? 'Draw Offered' : 'Offer Draw'}
                  </button>
                )}
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

      {isCompleted && !isSpectator && !modalDismissed && (
        <GameOverModal
          result={gameState.result}
          reason={gameState.reason}
          winner={gameState.winner}
          myColor={myColor}
          rematchOffer={rematchOffer}
          onRematch={requestRematch}
          onRespondRematch={respondRematch}
          onBackToLobby={() => navigate('/')}
          onDismiss={() => setModalDismissed(true)}
          isBotGame={gameState.isBotGame}
          botPersonality={gameState.botPersonality}
        />
      )}

      {isCompleted && isSpectator && (
        <div style={{
          marginTop: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
            Game over — {gameState.result} ({gameState.reason?.replace(/_/g, ' ')})
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}>
            Back to Lobby
          </button>
        </div>
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
              resultIcon={topResultIcon}
            />
          </div>

          <div style={{ position: 'absolute', bottom: 24, left: 24 }}>
            <Timer
              timeMs={myTime}
              player={myName}
              active={myTurnActive}
              resultIcon={bottomResultIcon}
            />
          </div>

          <ChessboardComponent
            key={`fs-${boardResetKey}`}
            position={displayFen}
            onPieceDrop={handlePieceDrop}
            boardSize={fullscreenBoardSize}
            boardOrientation={orientation}
            premoveSquares={isViewingHistory ? {} : mergedSquareStyles}
            onSquareClick={isViewingHistory ? undefined : handleSquareClick}
            onPieceClick={isViewingHistory ? undefined : handlePieceClick}
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
            {!gameState?.isBotGame && (
              <button className="btn btn-ghost" onClick={offerDraw}>
                Offer Draw
              </button>
            )}
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
