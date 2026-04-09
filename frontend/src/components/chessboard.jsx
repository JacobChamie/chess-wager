// src/components/chessboard.jsx
import { memo, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { BOARD_THEMES } from '../utils/boardThemes.js';

const CUSTOM_BOARD_STYLE = {
  borderRadius: '12px',
  overflow: 'hidden',
  boxShadow: '0 0 25px rgba(0, 0, 0, 0.7)',
};

const SPEED_MAP = { instant: 0, fast: 100, normal: 200, slow: 400 };

const ChessboardComponent = memo(({
  position,
  onPieceDrop,
  onPieceClick,
  onPieceDragBegin,
  onPieceDragEnd,
  boardSize = 320,
  onBoardSizeChange,
  boardOrientation = 'white',
  premoveSquares,
  onSquareRightClick,
  onSquareClick,
}) => {
  const minSize = 240;
  const maxSize = 640;
  const isResizable = typeof onBoardSizeChange === 'function';

  const handleResizeMouseDown = (e) => {
    if (!isResizable) return;

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = boardSize;

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const delta = Math.max(dx, dy);

      let newSize = startSize + delta;
      if (newSize < minSize) newSize = minSize;
      if (newSize > maxSize) newSize = maxSize;

      onBoardSizeChange(newSize);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const themeKey = typeof window !== 'undefined' ? localStorage.getItem('chess_board_theme') || 'default' : 'default';
  const theme = BOARD_THEMES[themeKey] || BOARD_THEMES.default;

  const speedKey = typeof window !== 'undefined' ? localStorage.getItem('chess_animation_speed') || 'normal' : 'normal';

  const wrapStyle = useMemo(() => ({
    width: boardSize,
    height: boardSize,
  }), [boardSize]);

  return (
    <div className="chessboard-wrap" style={wrapStyle}>
      <Chessboard
        id="main-board"
        position={position}
        onPieceDrop={onPieceDrop}
        boardWidth={boardSize}
        boardOrientation={boardOrientation}
        animationDuration={SPEED_MAP[speedKey] ?? 200}
        customBoardStyle={CUSTOM_BOARD_STYLE}
        customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
        customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
        customDropSquareStyle={{ backgroundColor: 'rgba(255, 255, 0, 0.3)' }}
        customSquareStyles={premoveSquares}
        onPieceClick={onPieceClick}
        onPieceDragBegin={onPieceDragBegin}
        onPieceDragEnd={onPieceDragEnd}
        onSquareClick={onSquareClick}
        onSquareRightClick={onSquareRightClick}
        snapToCursor={true}
        allowDragOutsideBoard={true}
        dropOffBoardAction="snapback"
        arePiecesDraggable={true}
      />

      {/* draggable resize "button" only in normal (resizable) mode */}
      {isResizable && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="chessboard-resize-handle"
          title="Drag to resize board"
        >
          <div className="chessboard-resize-handle-inner" />
        </div>
      )}
    </div>
  );
});

ChessboardComponent.displayName = 'ChessboardComponent';

export default ChessboardComponent;
