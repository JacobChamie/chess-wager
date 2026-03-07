const RESULT_LABELS = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold_repetition: 'Threefold Repetition',
  insufficient_material: 'Insufficient Material',
  draw: 'Draw',
  draw_agreement: 'Draw by Agreement',
  timeout: 'Time Ran Out',
  resign: 'Resignation',
  abandonment: 'Abandonment',
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
  onDismiss,
  isBotGame,
}) => {
  const resultText = RESULT_LABELS[reason] || 'Game Over';

  let outcomeText, outcomeColor;
  if (!winner) {
    outcomeText = 'Draw';
    outcomeColor = 'var(--text-secondary)';
  } else if (winner === myColor) {
    outcomeText = 'You Won!';
    outcomeColor = 'var(--accent)';
  } else {
    outcomeText = 'You Lost';
    outcomeColor = 'var(--danger)';
  }

  const showRespondRematch = rematchOffer && rematchOffer !== myColor;
  const waitingForRematch = rematchOffer === myColor;

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
            }}
            title="Close and analyze"
          >
            {'\u2715'}
          </button>
        )}
        <div
          style={{
            fontSize: '48px',
            lineHeight: 1,
            marginBottom: '8px',
            opacity: 0.7,
          }}
        >
          {winner === myColor ? '\uD83C\uDFC6' : winner ? '\u265A' : '\uD83E\uDD1D'}
        </div>

        <h2
          style={{
            fontSize: '28px',
            fontWeight: 800,
            color: outcomeColor,
            marginBottom: '4px',
          }}
        >
          {outcomeText}
        </h2>

        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            marginBottom: '8px',
          }}
        >
          {resultText}
        </p>

        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-muted)',
            marginBottom: '24px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {result}
        </p>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {isBotGame ? (
            <button className="btn btn-primary" onClick={onBackToLobby}>
              Play Again
            </button>
          ) : showRespondRematch ? (
            <>
              <button
                className="btn btn-primary"
                onClick={() => onRespondRematch(true)}
              >
                Accept Rematch
              </button>
              <button
                className="btn btn-danger"
                onClick={() => onRespondRematch(false)}
              >
                Decline
              </button>
            </>
          ) : waitingForRematch ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                color: 'var(--text-secondary)',
                fontSize: '14px',
              }}
            >
              <div className="spinner spinner-sm" />
              Waiting for opponent...
            </div>
          ) : (
            <button className="btn btn-primary" onClick={onRematch}>
              Rematch
            </button>
          )}

          <button className="btn btn-ghost" onClick={onBackToLobby}>
            Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameOverModal;
