import React, { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import BottomNav from './components/BottomNav.jsx';
import LobbyPage from './pages/LobbyPage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import PlayerProfilePage from './pages/PlayerProfilePage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import LichessCallbackPage from './pages/LichessCallbackPage.jsx';

const GamePage = lazy(() => import('./pages/GamePage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const WalletPage = lazy(() => import('./pages/WalletPage.jsx'));

const PageFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 52px)' }}>
    <div className="spinner" />
  </div>
);

const App = () => {
  return (
    <>
      <Navbar />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/game/:gameId" element={<GamePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/leaderboard/:username" element={<PlayerProfilePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/lichess/callback" element={<LichessCallbackPage />} />
        </Routes>
      </Suspense>
      <BottomNav />
    </>
  );
};

export default App;
