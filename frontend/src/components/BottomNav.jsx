import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SettingsModal from './SettingsModal.jsx';

const BottomNav = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isMobile) return null;

  // Hide on game pages to not interfere with game UI
  if (location.pathname.startsWith('/game/')) return null;

  const tabs = [
    { key: 'play', icon: '\u265F', label: 'Play', path: '/' },
    { key: 'rank', icon: '\uD83C\uDFC6', label: 'Rank', path: '/leaderboard' },
    { key: 'wallet', icon: '\uD83D\uDCB0', label: 'Wallet', path: '/wallet' },
    { key: 'settings', icon: '\u2699\uFE0F', label: 'Settings', action: () => setShowSettings(true) },
  ];

  // Add Premium tab for non-premium users (between Wallet and Settings)
  if (user && !user.is_premium) {
    tabs.splice(3, 0, { key: 'premium', icon: '\u2605', label: 'Premium', path: '/premium' });
  }

  if (user?.is_admin) {
    // Insert before Settings (which may be at index 3 or 4 now)
    const settingsIdx = tabs.findIndex((t) => t.key === 'settings');
    tabs.splice(settingsIdx, 0, { key: 'admin', icon: '\uD83D\uDEE1\uFE0F', label: 'Admin', path: '/admin' });
  }

  const isActive = (tab) => {
    if (tab.path === '/') return location.pathname === '/';
    if (tab.path) return location.pathname.startsWith(tab.path);
    return false;
  };

  return (
    <>
      <nav className="bottom-nav">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`bottom-nav-item${isActive(tab) ? ' active' : ''}`}
            onClick={() => tab.action ? tab.action() : navigate(tab.path)}
          >
            <span className="bottom-nav-icon">{tab.icon}</span>
            <span className="bottom-nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
};

export default BottomNav;
