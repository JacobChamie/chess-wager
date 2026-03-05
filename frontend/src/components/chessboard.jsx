// src/components/chessboard.jsx
import { memo } from 'react';
import { Chessboard } from 'react-chessboard';

const ChessboardComponent = memo(({
  position,
  onPieceDrop,
  boardSize = 320,
  onBoardSizeChange,
  boardOrientation = 'white',
  premoveSquares,
  onSquareRightClick,
  onSquareClick,
  onPieceClick,
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

  return (
    <div
      style={{
        position: 'relative',
        width: boardSize,
        height: boardSize,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        margin: '0 auto',
      }}
    >
      <Chessboard
        id="main-board"
        position={position}
        onPieceDrop={onPieceDrop}
        boardWidth={boardSize}
        boardOrientation={boardOrientation}
        animationDuration={100}
        customBoardStyle={{
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 0 25px rgba(0, 0, 0, 0.7)',
        }}
        customSquareStyles={premoveSquares}
        onSquareClick={onSquareClick}
        onPieceClick={onPieceClick}
        onSquareRightClick={onSquareRightClick}
      />

      {/* draggable resize "button" only in normal (resizable) mode */}
      {isResizable && (
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            width: 20,
            height: 20,
            cursor: 'se-resize',
            backgroundColor: 'rgba(0,0,0,0.4)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: 3,
            boxSizing: 'border-box',
          }}
          title="Drag to resize board"
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRight: '2px solid #ccc',
              borderBottom: '2px solid #ccc',
              borderRadius: 3,
            }}
          />
        </div>
      )}
    </div>
  );
});

ChessboardComponent.displayName = 'ChessboardComponent';

export default ChessboardComponent;
