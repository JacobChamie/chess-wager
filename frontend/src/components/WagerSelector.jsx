import { useAuth } from '../context/AuthContext.jsx';

const WAGER_OPTIONS = [0, 1, 5, 10, 25, 50, 100];

const WagerSelector = ({ value, onChange }) => {
  const { user } = useAuth();
  const balance = parseFloat(user?.token_balance) || 0;
  const isLoggedIn = !!user;

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
          const isSelected = value === amount;
          const disabled = amount > 0 && (!isLoggedIn || balance < amount);
          return (
            <button
              key={amount}
              className={`btn btn-sm${isSelected ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => onChange(amount)}
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
      </div>
      {value > 0 && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Each player wagers {value} tokens. Winner takes {value * 2}.
        </p>
      )}
    </div>
  );
};

export default WagerSelector;
