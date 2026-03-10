import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const PLATFORM_LABELS = { lichess: 'Lichess', chess_com: 'Chess.com' };

function getHeaders() {
  const token = localStorage.getItem('chess_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const LinkedAccounts = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chesscomUsername, setChesscomUsername] = useState('');
  const [pendingCode, setPendingCode] = useState(null);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/linked/accounts`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts);
        // Check for pending chess.com verification
        const pending = data.accounts.find((a) => a.platform === 'chess_com' && !a.is_verified);
        if (pending) {
          setPendingCode(pending.verification_code);
          setChesscomUsername(pending.platform_username);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchAccounts();
  }, [user, fetchAccounts]);

  if (!user) return null;

  const getAccount = (platform) => accounts.find((a) => a.platform === platform && a.is_verified);

  const handleLichessConnect = async () => {
    setError(null);
    setActionLoading('lichess');
    try {
      const res = await fetch(`${API_URL}/api/linked/lichess/auth`, { headers: getHeaders() });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError('Failed to start Lichess auth');
      }
    } catch {
      setError('Failed to connect to Lichess');
    } finally {
      setActionLoading(null);
    }
  };

  const handleChesscomStart = async () => {
    setError(null);
    if (!chesscomUsername.trim()) {
      setError('Enter your Chess.com username');
      return;
    }
    setActionLoading('chesscom_start');
    try {
      const res = await fetch(`${API_URL}/api/linked/chesscom/start`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ username: chesscomUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPendingCode(data.verificationCode);
      } else {
        setError(data.error || 'Failed to start verification');
      }
    } catch {
      setError('Failed to start Chess.com verification');
    } finally {
      setActionLoading(null);
    }
  };

  const handleChesscomVerify = async () => {
    setError(null);
    setActionLoading('chesscom_verify');
    try {
      const res = await fetch(`${API_URL}/api/linked/chesscom/verify`, {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        setPendingCode(null);
        fetchAccounts();
      } else {
        setError(data.error || 'Verification failed');
      }
    } catch {
      setError('Verification failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnlink = async (platform) => {
    setError(null);
    setActionLoading(`unlink_${platform}`);
    try {
      await fetch(`${API_URL}/api/linked/accounts/${platform}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (platform === 'chess_com') {
        setPendingCode(null);
        setChesscomUsername('');
      }
      fetchAccounts();
    } catch {
      setError('Failed to unlink');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefresh = async (platform) => {
    setError(null);
    setActionLoading(`refresh_${platform}`);
    try {
      const res = await fetch(`${API_URL}/api/linked/accounts/${platform}/refresh`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (res.ok) fetchAccounts();
      else setError('Failed to refresh ratings');
    } catch {
      setError('Failed to refresh ratings');
    } finally {
      setActionLoading(null);
    }
  };

  const renderRatings = (ratings) => {
    if (!ratings || Object.keys(ratings).length === 0) return null;
    return (
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
        {Object.entries(ratings).map(([tc, rating]) => (
          <span key={tc} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {tc.charAt(0).toUpperCase() + tc.slice(1)}: <strong style={{ color: 'var(--text-primary)' }}>{rating}</strong>
          </span>
        ))}
      </div>
    );
  };

  const renderLinkedAccount = (platform) => {
    const acct = getAccount(platform);
    if (!acct) return null;
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '4px',
        padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 600, fontSize: '13px' }}>{PLATFORM_LABELS[platform]}</span>
            <a
              href={acct.profile_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '13px', color: 'var(--accent-text)' }}
            >
              {acct.platform_username}
            </a>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '11px', padding: '2px 6px' }}
              onClick={() => handleRefresh(platform)}
              disabled={actionLoading === `refresh_${platform}`}
            >
              {actionLoading === `refresh_${platform}` ? '...' : 'Refresh'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '11px', padding: '2px 6px', color: '#e53935' }}
              onClick={() => handleUnlink(platform)}
              disabled={actionLoading === `unlink_${platform}`}
            >
              Unlink
            </button>
          </div>
        </div>
        {renderRatings(acct.ratings)}
      </div>
    );
  };

  if (loading) return <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading...</div>;

  const lichessLinked = getAccount('lichess');
  const chesscomLinked = getAccount('chess_com');

  return (
    <div className="form-group">
      <label className="form-label">Linked Accounts</label>
      {error && <div className="form-error" style={{ marginBottom: '8px' }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Lichess */}
        {lichessLinked ? (
          renderLinkedAccount('lichess')
        ) : (
          <button
            className="btn btn-ghost"
            onClick={handleLichessConnect}
            disabled={actionLoading === 'lichess'}
            style={{ justifyContent: 'flex-start', fontSize: '13px' }}
          >
            {actionLoading === 'lichess' ? 'Connecting...' : 'Connect Lichess'}
          </button>
        )}

        {/* Chess.com */}
        {chesscomLinked ? (
          renderLinkedAccount('chess_com')
        ) : pendingCode ? (
          <div style={{
            padding: '8px 12px', background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)', fontSize: '13px',
          }}>
            <div style={{ marginBottom: '6px' }}>
              <strong>Chess.com Verification</strong>
            </div>
            <div style={{ marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Add this code to your Chess.com profile Location field:
            </div>
            <div style={{
              fontFamily: 'monospace', background: 'var(--bg-primary)',
              padding: '6px 10px', borderRadius: '4px', marginBottom: '6px',
              userSelect: 'all', fontSize: '14px', fontWeight: 700,
            }}>
              {pendingCode}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleChesscomVerify}
              disabled={actionLoading === 'chesscom_verify'}
              style={{ fontSize: '12px' }}
            >
              {actionLoading === 'chesscom_verify' ? 'Checking...' : 'Check Verification'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              className="input"
              type="text"
              placeholder="Chess.com username"
              value={chesscomUsername}
              onChange={(e) => setChesscomUsername(e.target.value)}
              style={{ flex: 1, fontSize: '13px' }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleChesscomStart}
              disabled={actionLoading === 'chesscom_start'}
              style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
            >
              {actionLoading === 'chesscom_start' ? '...' : 'Verify'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedAccounts;
