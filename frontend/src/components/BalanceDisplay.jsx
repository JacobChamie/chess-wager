import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const BalanceDisplay = () => {
  const { user } = useAuth();
  if (!user) return null;

  const balance = parseFloat(user.token_balance) || 0;

  return (
    <Link
      to="/wallet"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        background: 'rgba(255, 215, 0, 0.1)',
        border: '1px solid rgba(255, 215, 0, 0.25)',
        borderRadius: 'var(--radius-sm)',
        color: '#ffd700',
        fontSize: '13px',
        fontWeight: 600,
        textDecoration: 'none',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
      title="Token balance — Click to manage wallet"
    >
      <span style={{ fontSize: '14px' }}>{'\u26C1'}</span>
      <span>{balance.toFixed(2)}</span>
    </Link>
  );
};

export default BalanceDisplay;
