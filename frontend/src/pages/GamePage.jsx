import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameSocket } from '../hooks/useGameSocket.js';
import { useBehaviorTracking } from '../hooks/useBehaviorTracking.js';
import ChessboardComponent from '../components/chessboard.jsx';
import ChatBox from '../components/chatbox.jsx';
import Timer from '../components/timer.jsx';
import GameOverModal from '../components/GameOverModal.jsx';
import DrawOfferBar from '../components/DrawOfferBar.jsx';
import PromotionPicker from '../components/PromotionPicker.jsx';
import ConfettiOverlay from '../components/ConfettiOverlay.jsx';
import ReportModal from '../components/ReportModal.jsx';
import CapturedPieces from '../components/CapturedPieces.jsx';
import { useGameTabTitle } from '../hooks/useGameTabTitle.js';
import { useAuth } from '../context/AuthContext.jsx';
import '../game.css';

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
  const { user, refreshUser } = useAuth();
  const [showReportModal, setShowReportModal] = useState(false);

  // Initialize behavior tracking (only for active players, not spectators)
  // We pass a placeholder and update once we know game state
  const getBehaviorData = useBehaviorTracking(gameId, true, false);

  const {
    gameState,
    connected,
    drawOffer,
    drawDeclined,
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
    getPremovePreviewChess,
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
  } = useGameSocket(gameId, getBehaviorData);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  const [chatExpanded, setChatExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const selectedSquareRef = useRef(null);
  const lastPieceClickRef = useRef({ square: null, at: 0 });
  const layoutRef = useRef(null);
  const dragStateRef = useRef({ active: false, sourceSquare: null, endedAt: 0 });
  const desktopRailWidth = sidebarOpen ? 360 : 84;

  const computeBoardSize = useCallback(() => {
    if (typeof window === 'undefined') return 320;
    const mobile = window.innerWidth < 640;
    if (mobile) {
      // Fill width minus padding
      return Math.min(window.innerWidth - 16, window.innerHeight - 336);
    }
    const layoutWidth = layoutRef.current?.clientWidth
      || document.querySelector('.app-main')?.clientWidth
      || Math.max(720, window.innerWidth - 64);
    const maxByWidth = Math.floor(layoutWidth - (desktopRailWidth * 2) - 56);
    const maxByHeight = Math.floor(window.innerHeight - 160);
    return Math.min(560, Math.max(280, Math.min(maxByWidth, maxByHeight)));
  }, [desktopRailWidth]);

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
  const [flipped, setFlipped] = useState(false);

  // Tab title + favicon badge
  useGameTabTitle(gameState ? {
    status: gameState.status,
    isMyTurn: gameState.myColor && gameState.turn === gameState.myColor,
    isSpectator: gameState.myColor === null,
  } : null);

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

  useEffect(() => {
    setBoardSize(computeBoardSize());
  }, [computeBoardSize, isMobile, sidebarOpen]);

  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const handleClickMoveRef = useRef(null);
  const updateSelectedSquare = useCallback((nextSquare) => {
    selectedSquareRef.current = nextSquare;
    setSelectedSquare(nextSquare);
  }, []);

  useEffect(() => {
    setModalDismissed(false);
  }, [gameId]);

  useEffect(() => {
    if (user?.id) {
      refreshUser();
    }
  }, [user?.id, refreshUser, gameId]);

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
      // Skip if user is typing
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // F to flip board
      if (e.key === 'f' || e.key === 'F') {
        setFlipped((v) => !v);
        return;
      }

      // Ctrl/Cmd+R to resign (prevent browser reload)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        const gs = gameStateRef.current;
        if (gs?.status === 'active' && gs?.myColor) {
          e.preventDefault();
          resign();
        }
        return;
      }

      // Ctrl/Cmd+D to offer draw (prevent bookmark)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        const gs = gameStateRef.current;
        if (gs?.status === 'active' && gs?.myColor) {
          e.preventDefault();
          offerDraw();
        }
        return;
      }

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
  }, [clearPremoves, navigatePrev, navigateNext, navigateFirst, navigateLast, resign, offerDraw]);

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
        const preview = getPremovePreviewChess();
        const previewMove = preview.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: 'q',
        });
        if (!previewMove) return false;

        const isPawn = piece?.[1] === 'P' || piece?.[1] === 'p';
        const isPromoRank =
          (gs.myColor === 'w' && targetSquare[1] === '8') ||
          (gs.myColor === 'b' && targetSquare[1] === '1');
        const promotion = isPawn && isPromoRank ? 'q' : undefined;
        addPremove(sourceSquare, targetSquare, promotion);
        updateSelectedSquare(null);
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
      updateSelectedSquare(null);
      return true;
    },
    [tryLocalMove, sendMove, addPremove, isViewingHistory, getPremovePreviewChess, updateSelectedSquare]
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

  // Core click-to-move logic for board taps/clicks
  const handleClickMove = useCallback(
    (square) => {
      const gs = gameStateRef.current;
      if (!gs || gs.status !== 'active') return;
      if (gs.myColor === null) return; // spectator

      const isMyTurn = gs.turn === gs.myColor;
      const chess = isMyTurn ? chessRef.current : getPremovePreviewChess();
      if (!chess) return;
      const piece = chess.get(square);
      const currentSelectedSquare = selectedSquareRef.current;

      if (currentSelectedSquare) {
        // Already have a piece selected — try to move there
        if (square === currentSelectedSquare) {
          // Clicked same square — deselect
          updateSelectedSquare(null);
          return;
        }

        // If it's our own piece, re-select it
        if (piece && piece.color === gs.myColor) {
          updateSelectedSquare(square);
          return;
        }

        if (isMyTurn) {
          // Check if this is a legal move from selectedSquare to square
          const legalMoves = chess.moves({ square: currentSelectedSquare, verbose: true });
          const matchingMove = legalMoves.find(m => m.to === square);

          if (matchingMove) {
            // Check for promotion
            const srcPiece = chess.get(currentSelectedSquare);
            const isPawn = srcPiece?.type === 'p';
            const isPromoRank =
              (gs.myColor === 'w' && square[1] === '8') ||
              (gs.myColor === 'b' && square[1] === '1');

            if (isPawn && isPromoRank) {
              setPendingPromotion({ from: currentSelectedSquare, to: square });
              updateSelectedSquare(null);
              return;
            }

            // Make the move
            const localMove = tryLocalMove(currentSelectedSquare, square);
            if (localMove) {
              sendMove(currentSelectedSquare, square);
            }
            updateSelectedSquare(null);
            return;
          }

          // Illegal square — deselect
          updateSelectedSquare(null);
          return;
        } else {
          const legalMoves = chess.moves({ square: currentSelectedSquare, verbose: true });
          const matchingMove = legalMoves.find((move) => move.to === square);
          if (!matchingMove) {
            updateSelectedSquare(null);
            return;
          }

          // Not our turn — queue as premove
          const srcPiece = chess.get(currentSelectedSquare);
          const isPawn = srcPiece?.type === 'p';
          const isPromoRank =
            (gs.myColor === 'w' && square[1] === '8') ||
            (gs.myColor === 'b' && square[1] === '1');
          const promotion = isPawn && isPromoRank ? 'q' : undefined;
          addPremove(currentSelectedSquare, square, promotion);
          updateSelectedSquare(null);
          return;
        }
      }

      // No selection yet — select if it's our piece
      if (piece && piece.color === gs.myColor) {
        updateSelectedSquare(square);
      }
    },
    [chessRef, tryLocalMove, sendMove, addPremove, getPremovePreviewChess, updateSelectedSquare]
  );

  // Keep ref in sync for handlePieceDrop same-square-drop routing
  handleClickMoveRef.current = handleClickMove;

  // onSquareClick — fires when clicking empty squares (or squares without draggable pieces)
  const handleSquareClick = useCallback(
    (square, piece) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (
        piece &&
        lastPieceClickRef.current.square === square &&
        now - lastPieceClickRef.current.at < 32
      ) {
        return;
      }
      handleClickMove(square);
    },
    [handleClickMove]
  );

  const handlePieceClick = useCallback(
    (_piece, square) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (
        dragStateRef.current.active
        || (
          dragStateRef.current.sourceSquare === square
          && now - dragStateRef.current.endedAt < 120
        )
      ) {
        return;
      }
      lastPieceClickRef.current = {
        square,
        at: now,
      };
      handleClickMove(square);
    },
    [handleClickMove]
  );

  const handlePieceDragBegin = useCallback((_piece, sourceSquare) => {
    dragStateRef.current = {
      active: true,
      sourceSquare,
      endedAt: 0,
    };
  }, []);

  const handlePieceDragEnd = useCallback((_piece, sourceSquare) => {
    dragStateRef.current = {
      active: false,
      sourceSquare,
      endedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const api = window.__CHESS_TEST_API__;
    if (!api?.setBoardActions) return undefined;

    api.setBoardActions({
      pieceDrop: handlePieceDrop,
      pieceClick: handlePieceClick,
      squareClick: handleSquareClick,
    });

    return () => {
      api.setBoardActions(null);
    };
  }, [handlePieceClick, handlePieceDrop, handleSquareClick]);

  // Clear selection only when game ends (not on every FEN change)
  useEffect(() => {
    updateSelectedSquare(null);
  }, [gameState?.status, updateSelectedSquare]);

  const handleSquareRightClick = useCallback(() => {
    updateSelectedSquare(null);
    clearPremoves();
  }, [clearPremoves, updateSelectedSquare]);

  // Merge last-move + premove + click-to-move highlights
  const mergedSquareStyles = useMemo(() => {
    const styles = { ...premoveSquares };
    const gs = gameStateRef.current;
    if (lastMove) {
      styles[lastMove.from] = {
        backgroundColor: 'rgba(255, 255, 0, 0.2)',
        ...(styles[lastMove.from] || {}),
      };
      styles[lastMove.to] = {
        backgroundColor: 'rgba(255, 255, 0, 0.25)',
        ...(styles[lastMove.to] || {}),
      };
    }
    if (selectedSquare && chessRef.current) {
      const moveSourceChess =
        gs && gs.myColor !== null && gs.turn !== gs.myColor
          ? getPremovePreviewChess()
          : chessRef.current;
      styles[selectedSquare] = {
        backgroundColor: 'rgba(255, 255, 0, 0.4)',
        ...(styles[selectedSquare] || {}),
      };
      const legalMoves = moveSourceChess.moves({ square: selectedSquare, verbose: true });
      for (const m of legalMoves) {
        const existing = styles[m.to] || {};
        if (m.captured) {
          styles[m.to] = {
            background: 'radial-gradient(circle, transparent 55%, rgba(0,0,0,0.25) 56%)',
            borderRadius: '50%',
            ...existing,
          };
        } else {
          styles[m.to] = {
            background: 'radial-gradient(circle, rgba(0,0,0,0.2) 20%, transparent 21%)',
            ...existing,
          };
        }
      }
    }
    return styles;
  }, [premoveSquares, lastMove, selectedSquare, chessRef, getPremovePreviewChess]);

  if (!connected || !gameState) {
    return (
      <div className="game-loading">
        <div className="spinner" />
        <p className="game-loading-text">
          Connecting to game...
        </p>
      </div>
    );
  }

  const isActive = gameState.status === 'active';
  const isCompleted = gameState.status === 'completed';
  const myColor = gameState.myColor;
  const isSpectator = myColor === null;
  const baseOrientation = myColor === 'b' ? 'black' : 'white'; // spectators see white at bottom
  const orientation = flipped ? (baseOrientation === 'white' ? 'black' : 'white') : baseOrientation;

  // For spectators: top = black, bottom = white
  const topName = isSpectator ? gameState.blackName : (myColor === 'w' ? gameState.blackName : gameState.whiteName);
  const bottomName = isSpectator ? gameState.whiteName : (myColor === 'w' ? gameState.whiteName : gameState.blackName);
  const topTime = isSpectator ? gameState.blackTime : (myColor === 'w' ? gameState.blackTime : gameState.whiteTime);
  const bottomTime = isSpectator ? gameState.whiteTime : (myColor === 'w' ? gameState.whiteTime : gameState.blackTime);
  const topColor = isSpectator ? 'b' : (myColor === 'w' ? 'b' : 'w');
  const bottomColor = isSpectator ? 'w' : myColor;
  const topTurnActive = gameState.turn === topColor && isActive;
  const bottomTurnActive = gameState.turn === bottomColor && isActive;

  // Premium status for timers
  const topIsPremium = isSpectator
    ? (gameState.blackIsPremium || false)
    : (myColor === 'w' ? gameState.blackIsPremium : gameState.whiteIsPremium) || false;
  const bottomIsPremium = isSpectator
    ? (gameState.whiteIsPremium || false)
    : (myColor === 'w' ? gameState.whiteIsPremium : gameState.blackIsPremium) || false;

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

  return (
    <div className="game-container">
      {cheerReceived && <ConfettiOverlay targetColor={cheerReceived.targetColor} />}

      {disconnectTime && !gameState?.isBotGame && <DisconnectBanner disconnectTime={disconnectTime} />}

      {moveError && (
        <div className="game-move-error">
          Move rejected: {moveError}
        </div>
      )}

      <div
        ref={layoutRef}
        className={`game-layout ${isMobile ? 'game-layout--mobile' : 'game-layout--desktop'}`}
        style={{
          '--board-size': `${boardSize}px`,
          '--game-rail-width': `${desktopRailWidth}px`,
        }}
      >
        {!isFullscreen && !isMobile && <div className="game-balance-rail" aria-hidden="true" />}

        {/* Board column */}
        {!isFullscreen && (
          <div className="game-board-col">
            {gameState.isWagerGame && gameState.wagerAmount > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'center', marginBottom: '6px',
              }}>
                <span style={{
                  background: 'rgba(255, 215, 0, 0.15)', border: '1px solid rgba(255, 215, 0, 0.3)',
                  borderRadius: 'var(--radius-sm)', padding: '3px 12px',
                  fontSize: '12px', fontWeight: 700, color: '#ffd700',
                }}>
                  {'\u26C1'} {gameState.wagerAmount} Token Wager
                </span>
              </div>
            )}
            <div className="game-player-strip">
              <Timer
                timeMs={opponentTime}
                player={opponentName}
                active={opponentTurnActive}
                resultIcon={topResultIcon}
                isPremium={topIsPremium}
              />
              <CapturedPieces fen={gameState.fen} color={topColor} />
            </div>

            <ChessboardComponent
              key={boardResetKey}
              position={displayFen}
              onPieceDrop={handlePieceDrop}
              onPieceClick={isViewingHistory ? undefined : handlePieceClick}
              onPieceDragBegin={isViewingHistory ? undefined : handlePieceDragBegin}
              onPieceDragEnd={isViewingHistory ? undefined : handlePieceDragEnd}
              boardSize={boardSize}
              onBoardSizeChange={isMobile ? undefined : setBoardSize}
              boardOrientation={orientation}
              premoveSquares={isViewingHistory ? {} : mergedSquareStyles}
              onSquareClick={isViewingHistory ? undefined : handleSquareClick}
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
            <div className="game-nav-buttons">
              <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigateFirst} title="First move">
                {'|<'}
              </button>
              <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigatePrev} title="Previous move">
                {'<'}
              </button>
              <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigateNext} title="Next move">
                {'>'}
              </button>
              <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigateLast} title="Last move (live)">
                {'>|'}
              </button>
            </div>

            {isViewingHistory && (
              <div className="game-history-banner">
                <span>Viewing move {viewMoveIndex === -1 ? 'start' : viewMoveIndex + 1}</span>
                <button className="btn btn-ghost btn-sm" onClick={navigateLast}>
                  Return to live
                </button>
              </div>
            )}

            {!isMobile && (
              <button
                className="btn btn-ghost btn-sm game-fullscreen-btn"
                onClick={() => setIsFullscreen(true)}
              >
                Full board
              </button>
            )}

            <div className="game-player-strip">
              <CapturedPieces fen={gameState.fen} color={bottomColor} />
              <Timer
                timeMs={myTime}
                player={myName}
                active={myTurnActive}
                resultIcon={bottomResultIcon}
                isPremium={bottomIsPremium}
              />
            </div>

            {/* Mobile draw offer bar */}
            {isMobile && showDrawOffer && (
              <DrawOfferBar
                onAccept={() => respondDraw(true)}
                onDecline={() => respondDraw(false)}
              />
            )}

            {/* Mobile action buttons inline */}
            {isMobile && isActive && !isSpectator && (
              <div className="game-mobile-actions">
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
                    disabled={!!drawOffer || drawDeclined}
                    style={{ flex: 1 }}
                  >
                    {drawOffer === myColor ? 'Draw Offered' : drawDeclined ? 'Draw Declined' : 'Offer Draw'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat + actions column — collapsible on mobile */}
        {!isFullscreen && isMobile && (
          <div className="game-mobile-chat-wrap">
            <button
              className="btn btn-ghost btn-sm game-chat-toggle"
              onClick={() => setChatExpanded((v) => !v)}
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

        {/* Desktop sidebar toggle when hidden — spacer keeps board in place */}
        {!isFullscreen && !isMobile && !sidebarOpen && (
          <div className="game-sidebar-spacer">
            <button
              className="btn btn-ghost btn-sm game-panel-toggle"
              onClick={() => setSidebarOpen(true)}
              title="Show panel"
            >
              {'\u25C0'} Panel
            </button>
          </div>
        )}

        {/* Desktop chat + actions */}
        {!isFullscreen && !isMobile && sidebarOpen && (
          <div className="game-sidebar">
            <div className="game-sidebar-header">
              {spectatorCount > 0 ? (
                <div className="spectator-badge">
                  {'\uD83D\uDC41'} {spectatorCount} watching
                </div>
              ) : <div />}
              <button
                className="btn btn-ghost btn-sm game-sidebar-close"
                onClick={() => setSidebarOpen(false)}
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
              <div className="game-sidebar-actions">
                <button
                  className="btn btn-danger"
                  onClick={resign}
                  style={{ flex: 1 }}
                >
                  Resign
                </button>
                {!gameState?.isBotGame && (
                  <button
                    className="btn btn-ghost"
                    onClick={offerDraw}
                    disabled={!!drawOffer || drawDeclined}
                    style={{ flex: 1 }}
                  >
                    {drawOffer === myColor ? 'Draw Offered' : drawDeclined ? 'Draw Declined' : 'Offer Draw'}
                  </button>
                )}
                {user && !gameState?.isBotGame && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowReportModal(true)}
                    title="Report opponent"
                    style={{ padding: '8px', minWidth: 'auto' }}
                  >
                    {'\u2691'}
                  </button>
                )}
              </div>
            )}

            {isActive && isSpectator && (
              <div className="game-sidebar-actions">
                <button
                  className="btn btn-sm game-cheer-btn--white"
                  onClick={() => sendCheer('w')}
                  disabled={cheerCooldown > 0 || gameState.whiteTime < 30000 || gameState.blackTime < 30000}
                  style={{ flex: 1 }}
                >
                  {cheerCooldown > 0 ? `${cheerCooldown}s` : 'Cheer White'}
                </button>
                <button
                  className="btn btn-sm game-cheer-btn--black"
                  onClick={() => sendCheer('b')}
                  disabled={cheerCooldown > 0 || gameState.whiteTime < 30000 || gameState.blackTime < 30000}
                  style={{ flex: 1 }}
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
          wagerAmount={gameState.wagerAmount}
          isWagerGame={gameState.isWagerGame}
        />
      )}

      {isCompleted && isSpectator && (
        <div className="game-spectator-completed">
          <div className="game-spectator-completed-text">
            Game over — {gameState.result} ({gameState.reason?.replace(/_/g, ' ')})
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}>
            Back to Lobby
          </button>
        </div>
      )}

      {/* Report button after game completes (non-fullscreen) */}
      {isCompleted && !isSpectator && !isFullscreen && user && !gameState?.isBotGame && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowReportModal(true)}
            style={{ fontSize: '12px' }}
          >
            {'\u2691'} Report Opponent
          </button>
        </div>
      )}

      {isFullscreen && (
        <div className="game-fullscreen">
          <div className="game-fullscreen-timer-top">
            <Timer
              timeMs={opponentTime}
              player={opponentName}
              active={opponentTurnActive}
              resultIcon={topResultIcon}
              isPremium={topIsPremium}
            />
            <CapturedPieces fen={gameState.fen} color={topColor} />
          </div>

          <div className="game-fullscreen-timer-bottom">
            <CapturedPieces fen={gameState.fen} color={bottomColor} />
            <Timer
              timeMs={myTime}
              player={myName}
              active={myTurnActive}
              resultIcon={bottomResultIcon}
              isPremium={bottomIsPremium}
            />
          </div>

          <ChessboardComponent
            key={`fs-${boardResetKey}`}
            position={displayFen}
            onPieceDrop={handlePieceDrop}
            onPieceClick={isViewingHistory ? undefined : handlePieceClick}
            onPieceDragBegin={isViewingHistory ? undefined : handlePieceDragBegin}
            onPieceDragEnd={isViewingHistory ? undefined : handlePieceDragEnd}
            boardSize={fullscreenBoardSize}
            boardOrientation={orientation}
            premoveSquares={isViewingHistory ? {} : mergedSquareStyles}
            onSquareClick={isViewingHistory ? undefined : handleSquareClick}
            onSquareRightClick={handleSquareRightClick}
          />

          {/* Fullscreen nav buttons */}
          <div className="game-nav-buttons" style={{ marginTop: '8px' }}>
            <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigateFirst} title="First move">
              {'|<'}
            </button>
            <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigatePrev} title="Previous move">
              {'<'}
            </button>
            <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigateNext} title="Next move">
              {'>'}
            </button>
            <button className="btn btn-ghost btn-sm game-nav-btn" onClick={navigateLast} title="Last move (live)">
              {'>|'}
            </button>
          </div>

          {isViewingHistory && (
            <div className="game-history-banner">
              <span>Viewing move {viewMoveIndex === -1 ? 'start' : viewMoveIndex + 1}</span>
              <button className="btn btn-ghost btn-sm" onClick={navigateLast}>
                Return to live
              </button>
            </div>
          )}

          {pendingPromotion && (
            <PromotionPicker
              color={myColor}
              onSelect={handlePromotionChoice}
              onCancel={handlePromotionCancel}
            />
          )}

          {showDrawOffer && (
            <div style={{ position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000 }}>
              <DrawOfferBar
                onAccept={() => respondDraw(true)}
                onDecline={() => respondDraw(false)}
              />
            </div>
          )}

          {isActive && !isSpectator && (
            <div className="game-fullscreen-actions">
              <button className="btn btn-danger" onClick={resign}>
                Resign
              </button>
              {!gameState?.isBotGame && (
                <button className="btn btn-ghost" onClick={offerDraw}>
                  Offer Draw
                </button>
              )}
            </div>
          )}

          <div className="game-fullscreen-exit">
            <button
              className="btn btn-ghost"
              onClick={() => setIsFullscreen(false)}
            >
              Exit full board
            </button>
          </div>
        </div>
      )}
      {showReportModal && (
        <ReportModal
          opponentId={myColor === 'w' ? gameState.blackUserId : gameState.whiteUserId}
          gameId={gameId}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
};

export default GamePage;
