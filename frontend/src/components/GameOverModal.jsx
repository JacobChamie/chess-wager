import React from 'react';

const RESULT_LABELS = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold_repetition: 'Draw by threefold repetition',
  insufficient_material: 'Draw by insufficient material',
  draw: 'Draw',
  draw_agreement: 'Draw by agreement',
  timeout: 'Win on time',
  resign: 'Win by resignation',
  abandonment: 'Win by abandonment',
  game_over: 'Game Over',
};

const GameOverModal = ({
  result,
  reason,
  winner,
  myColor,
  rematchOffer,
  onRematch,
  onRespondRematch,
  onBackToLobby,
}) => {
  const resultText = RESULT_LABELS[reason] || 'Game Over';

  let outcomeText;
  if (!winner) {
    outcomeText = 'The game ended in a draw.';
  } else if (winner === myColor) {
    outcomeText = 'You won!';
  } else {
    outcomeText = 'You lost.';
  }

  // If opponent offered rematch
  const showRespondRematch = rematchOffer && rematchOffer !== myColor;
  // If I offered rematch
  const waitingForRematch = rematchOffer === myColor;

  return (
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
          color: '#f5f5f5',
        }}
      >
        <h2 style={{ marginBottom: '12px', fontSize: '1.8rem' }}>
          {resultText}
        </h2>

        <p style={{ marginBottom: '16px', fontSize: '1.1rem' }}>
          {outcomeText}
        </p>

        <p style={{ marginBottom: '16px', fontSize: '0.95rem', color: '#ccc' }}>
          Result: {result}
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          {showRespondRematch ? (
            <>
              <button
                onClick={() => onRespondRematch(true)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#4caf50',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Accept Rematch
              </button>
              <button
                onClick={() => onRespondRematch(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#e53935',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Decline
              </button>
            </>
          ) : waitingForRematch ? (
            <p style={{ fontSize: '0.95rem', color: '#aaa' }}>
              Waiting for opponent...
            </p>
          ) : (
            <button
              onClick={onRematch}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4caf50',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Rematch
            </button>
          )}

          <button
            onClick={onBackToLobby}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#555',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameOverModal;
