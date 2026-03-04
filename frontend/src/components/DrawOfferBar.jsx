import React from 'react';

const DrawOfferBar = ({ onAccept, onDecline }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        backgroundColor: '#3a3a2a',
        borderRadius: '8px',
        border: '1px solid #666',
        fontSize: '0.9rem',
      }}
    >
      <span style={{ flex: 1, color: '#f5f5f5' }}>
        Opponent offers a draw
      </span>
      <button
        onClick={onAccept}
        style={{
          padding: '6px 14px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: '#4caf50',
          color: '#fff',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '0.85rem',
        }}
      >
        Accept
      </button>
      <button
        onClick={onDecline}
        style={{
          padding: '6px 14px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: '#e53935',
          color: '#fff',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '0.85rem',
        }}
      >
        Decline
      </button>
    </div>
  );
};

export default DrawOfferBar;
