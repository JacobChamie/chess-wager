import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const WAGER_OPTIONS = [0, 1, 5, 10, 25, 50, 100];

const WagerSelector = ({ value, onChange }) => {
  const { user } = useAuth();
  const balance = parseFloat(user?.token_balance) || 0;
  const isLoggedIn = !!user;
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const isPreset = WAGER_OPTIONS.includes(value);

  const handleCustomConfirm = () => {
    const num = parseInt(customInput, 10);
    if (!num || num < 1) return;
    const clamped = Math.min(num, Math.floor(balance));
    if (clamped < 1) return;
    onChange(clamped);
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
        Wager (Tokens)
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {WAGER_OPTIONS.map((amount) => {
          const isSelected = value === amount && !showCustom;
          const disabled = amount > 0 && (!isLoggedIn || balance < amount);
          return (
            <button
              key={amount}
              className={`btn btn-sm${isSelected ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => {
                setShowCustom(false);
                setCustomInput('');
                onChange(amount);
              }}
              disabled={disabled}
              style={{
                minWidth: '52px',
                opacity: disabled ? 0.4 : 1,
              }}
              title={
                !isLoggedIn && amount > 0
                  ? 'Sign in to play wager games'
                  : balance < amount
                    ? `Insufficient balance (${balance.toFixed(2)} tokens)`
                    : amount === 0
                      ? 'Free game'
                      : `Wager ${amount} tokens`
              }
            >
              {amount === 0 ? 'Free' : amount}
            </button>
          );
        })}
        <button
          className={`btn btn-sm${showCustom || (!isPreset && value > 0) ? ' btn-primary' : ' btn-ghost'}`}
          onClick={() => {
            if (!isLoggedIn) return;
            setShowCustom(true);
            if (!isPreset && value > 0) setCustomInput(String(value));
          }}
          disabled={!isLoggedIn || balance < 1}
          style={{
            minWidth: '52px',
            opacity: !isLoggedIn || balance < 1 ? 0.4 : 1,
          }}
          title={!isLoggedIn ? 'Sign in to play wager games' : 'Enter a custom wager amount'}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <div
          style={{
            marginTop: '8px',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <input
            className="input input-sm"
            type="number"
            placeholder="Amount"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomConfirm()}
            min="1"
            max={Math.floor(balance)}
            step="1"
            style={{ width: '120px' }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleCustomConfirm}
            disabled={!customInput || parseInt(customInput, 10) < 1 || parseInt(customInput, 10) > balance}
          >
            Set
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            1 &ndash; {Math.floor(balance)} tokens
          </span>
        </div>
      )}

      {value > 0 && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Each player wagers {value} tokens. Winner takes {value * 2}.
        </p>
      )}
    </div>
  );
};

export default WagerSelector;
