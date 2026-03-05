import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { socket } from '../socket.js';
import AuthModal from './AuthModal.jsx';
import SettingsModal from './SettingsModal.jsx';

const Navbar = () => {
  const { user, logout } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [activeGames, setActiveGames] = useState(0);

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
        </div>

        <div className="navbar-actions">
          {user?.is_admin && (
            <Link to="/admin" className="navbar-icon-btn" title="Admin">
              {'\uD83D\uDEE1\uFE0F'}
            </Link>
          )}
          <Link to="/leaderboard" className="navbar-icon-btn" title="Leaderboard">
            {'\uD83C\uDFC6'}
          </Link>
          <button
            className="navbar-icon-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            {'\u2699\uFE0F'}
          </button>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Link to={`/leaderboard/${user.username}`} className="navbar-user" style={{ textDecoration: 'none' }}>
                {user.username}
              </Link>
              <button className="btn btn-ghost btn-sm navbar-signout" onClick={logout}>
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

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
};

export default Navbar;
