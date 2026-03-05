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

  useEffect(() => {
    const onCount = ({ count }) => setOnlineCount(count);
    socket.on('online:count', onCount);
    return () => socket.off('online:count', onCount);
  }, []);

  return (
    <>
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/" className="navbar-logo">
            <span style={{ fontSize: '20px' }}>{'\u265A'}</span>
            ELO Stakes
          </Link>
          <div className="online-indicator">
            <span className="online-dot" />
            <span className="online-count">{onlineCount}</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Link to={`/leaderboard/${user.username}`} className="navbar-user" style={{ textDecoration: 'none' }}>
                {user.username}
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={logout}>
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
