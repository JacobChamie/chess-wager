import { useState } from 'react';

const WagerGateSelector = ({ gates, onChange, visible }) => {
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  const update = (key, value) => {
    onChange({ ...gates, [key]: value });
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <label
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          marginBottom: '8px',
        }}
      >
        Wager Requirements
      </label>

      {/* Require verified toggle */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '8px',
        }}
      >
        <input
          type="checkbox"
          checked={gates.requireVerified || false}
          onChange={(e) => update('requireVerified', e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        Require verified account (100+ games)
      </label>

      {/* Minimum rating section */}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setExpanded((v) => !v)}
        style={{ marginBottom: expanded ? '8px' : 0, fontSize: '13px' }}
      >
        {expanded ? 'Hide' : 'Set'} minimum rating requirement
      </button>

      {expanded && (
        <div
          style={{
            padding: '12px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ flex: '1 1 120px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Platform
            </label>
            <select
              className="input input-sm"
              value={gates.minExternalPlatform || ''}
              onChange={(e) => update('minExternalPlatform', e.target.value || null)}
            >
              <option value="">Select...</option>
              <option value="chess.com">Chess.com</option>
              <option value="lichess">Lichess</option>
            </select>
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Time Control
            </label>
            <select
              className="input input-sm"
              value={gates.minExternalTimeControl || ''}
              onChange={(e) => update('minExternalTimeControl', e.target.value || null)}
            >
              <option value="">Select...</option>
              <option value="bullet">Bullet</option>
              <option value="blitz">Blitz</option>
              <option value="rapid">Rapid</option>
              <option value="classical">Classical</option>
            </select>
          </div>
          <div style={{ flex: '1 1 80px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Min Rating
            </label>
            <input
              className="input input-sm"
              type="number"
              value={gates.minExternalRating || ''}
              onChange={(e) => update('minExternalRating', parseInt(e.target.value) || null)}
              placeholder="e.g. 1500"
              min="0"
              max="3500"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WagerGateSelector;
