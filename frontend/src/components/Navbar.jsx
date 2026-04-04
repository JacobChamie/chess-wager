import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { socket } from '../socket.js';
import AuthModal from './AuthModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import BalanceDisplay from './BalanceDisplay.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const Navbar = ({ onToggleChat, chatOpen }) => {
  const { user, logout } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [activeGames, setActiveGames] = useState(0);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendMsg, setResendMsg] = useState(null);

  useEffect(() => {
    const onCount = ({ count, games }) => {
      setOnlineCount(count);
      if (games !== undefined) setActiveGames(games);
    };
    const onGames = ({ games }) => setActiveGames(games);
    socket.on('online:count', onCount);
    socket.on('online:games', onGames);
    return () => {
      socket.off('online:count', onCount);
      socket.off('online:games', onGames);
    };
  }, []);

  return (
    <>
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/" className="navbar-logo">
            <span style={{ fontSize: '20px' }}>{'\u265A'}</span>
            <span className="navbar-logo-text">ELO Stakes</span>
          </Link>
          <div className="online-indicator" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="online-dot" />
            <span title="Players online" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'default' }}>
              <span>{'\uD83D\uDC64'}</span>
              <span>{onlineCount}</span>
            </span>
            <span title="Active games" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'default' }}>
              <span>{'\u265F'}</span>
              <span>{activeGames}</span>
            </span>
          </div>
          {onToggleChat && (
            <button
              className="navbar-icon-btn"
              onClick={onToggleChat}
              title={chatOpen ? 'Hide chat' : 'Show chat'}
              style={{ opacity: chatOpen ? 1 : 0.5 }}
            >
              {'\uD83D\uDCAC'}
            </button>
          )}
        </div>

        <div className="navbar-actions">
          <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {user?.is_admin && (
              <Link to="/admin" className="navbar-icon-btn" title="Admin">
                {'\uD83D\uDEE1\uFE0F'}
              </Link>
            )}
            <Link to="/leaderboard" className="navbar-icon-btn" title="Leaderboard">
              {'\uD83C\uDFC6'}
            </Link>
            <Link to="/faq" className="navbar-icon-btn" title="FAQ">
              ?
            </Link>
            <button
              className="navbar-icon-btn"
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              {'\u2699\uFE0F'}
            </button>
          </div>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BalanceDisplay />
              {!user.is_premium && !user.is_admin && (
                <Link
                  to="/premium"
                  className="hide-mobile"
                  style={{
                    textDecoration: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,170,0,0.15))',
                    color: '#ffd700',
                    border: '1px solid rgba(255,215,0,0.3)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Go Premium
                </Link>
              )}
              <Link
                to={`/leaderboard/${user.username}`}
                className="navbar-user hide-mobile"
                style={{
                  textDecoration: 'none',
                  ...(user.is_admin
                    ? { color: '#ff4444', fontWeight: 700 }
                    : user.is_premium
                      ? { color: '#ffd700', fontWeight: 700, textShadow: '0 0 6px rgba(255, 215, 0, 0.4)' }
                      : {}),
                }}
              >
                {user.is_premium && !user.is_admin && '\u2605 '}
                {user.username}
                {user.is_admin && <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.8 }}>ADMIN</span>}
              </Link>
              <button className="btn btn-ghost btn-sm navbar-signout hide-mobile" onClick={logout}>
                Sign Out
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setShowAuth(true)}>
              Sign In
            </button>
          )}
        </div>
      </nav>

      {user && user.email_verified === false && (
        <div style={{
          background: 'rgba(255, 152, 0, 0.12)',
          borderBottom: '1px solid rgba(255, 152, 0, 0.3)',
          padding: '6px 16px',
          fontSize: '13px',
          color: '#ffa726',
          textAlign: 'center',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>Verify your email to secure your account.</span>
          {resendMsg ? (
            <span style={{ color: '#66bb6a' }}>{resendMsg}</span>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              disabled={resendingEmail}
              onClick={async () => {
                setResendingEmail(true);
                try {
                  const token = localStorage.getItem('chess_token');
                  const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  const data = await res.json();
                  setResendMsg(data.message || data.error || 'Sent!');
                  setTimeout(() => setResendMsg(null), 5000);
                } catch {
                  setResendMsg('Failed to send');
                  setTimeout(() => setResendMsg(null), 3000);
                } finally {
                  setResendingEmail(false);
                }
              }}
              style={{ fontSize: '12px', padding: '2px 8px', color: '#ffa726' }}
            >
              {resendingEmail ? 'Sending...' : 'Resend'}
            </button>
          )}
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
};

export default Navbar;
