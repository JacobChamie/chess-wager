const DrawOfferBar = ({ onAccept, onDecline }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 16px',
        background: 'rgba(124, 179, 66, 0.08)',
        border: '1px solid rgba(124, 179, 66, 0.25)',
        borderRadius: 'var(--radius)',
        fontSize: '14px',
      }}
    >
      <span style={{ flex: 1, fontWeight: 500 }}>
        Opponent offers a draw
      </span>
      <button className="btn btn-primary btn-sm" onClick={onAccept}>
        Accept
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onDecline}>
        Decline
      </button>
    </div>
  );
};

export default DrawOfferBar;
