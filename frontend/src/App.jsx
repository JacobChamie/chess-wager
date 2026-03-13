import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import BottomNav from './components/BottomNav.jsx';
import GlobalChat from './components/GlobalChat.jsx';
import LobbyPage from './pages/LobbyPage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import PlayerProfilePage from './pages/PlayerProfilePage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import LichessCallbackPage from './pages/LichessCallbackPage.jsx';

const GamePage = lazy(() => import('./pages/GamePage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const WalletPage = lazy(() => import('./pages/WalletPage.jsx'));
const PremiumPage = lazy(() => import('./pages/PremiumPage.jsx'));

const PageFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 52px)' }}>
    <div className="spinner" />
  </div>
);

const App = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [chatOpen, setChatOpen] = useState(() => !isMobile);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <>
      <Navbar onToggleChat={() => setChatOpen((v) => !v)} chatOpen={chatOpen} />
      <div className="app-body">
        {chatOpen && !isMobile && (
          <aside className="app-chat-panel">
            <GlobalChat />
          </aside>
        )}
        <main className="app-main">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<LobbyPage />} />
              <Route path="/game/:gameId" element={<GamePage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/leaderboard/:username" element={<PlayerProfilePage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/premium" element={<PremiumPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/lichess/callback" element={<LichessCallbackPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {isMobile && chatOpen && (
        <div className="app-chat-mobile-overlay" onClick={() => setChatOpen(false)}>
          <div className="app-chat-mobile-panel" onClick={(e) => e.stopPropagation()}>
            <GlobalChat />
          </div>
        </div>
      )}
      <BottomNav />
    </>
  );
};

export default App;
