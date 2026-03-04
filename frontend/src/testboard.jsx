// src/TestBoard.jsx
import React from 'react';
import { Chessboard } from 'react-chessboard';

export default function TestBoard() {
  return (
    <div style={{ width: 400 }}>
      <Chessboard
        id="test-board"
        position="start"
        onPieceDrop={(from, to, piece) => {
          console.log('DROP', { from, to, piece });
          return true;
        }}
      />
    </div>
  );
}
