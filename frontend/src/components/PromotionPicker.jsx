const PIECES = [
  { key: 'q', label: 'Queen', white: '\u2655', black: '\u265B' },
  { key: 'r', label: 'Rook', white: '\u2656', black: '\u265C' },
  { key: 'b', label: 'Bishop', white: '\u2657', black: '\u265D' },
  { key: 'n', label: 'Knight', white: '\u2658', black: '\u265E' },
];

const PromotionPicker = ({ color, onSelect, onCancel }) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 100,
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Picker */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          gap: '6px',
          background: 'var(--bg-surface)',
          padding: '10px',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)',
        }}
      >
        {PIECES.map(({ key, label, white, black }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            title={label}
            className="btn"
            style={{
              width: 'min(60px, 14vw)',
              height: 'min(60px, 14vw)',
              fontSize: 'min(36px, 8vw)',
              padding: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
            }}
          >
            {color === 'w' ? white : black}
          </button>
        ))}
      </div>
    </div>
  );
};

export default PromotionPicker;
