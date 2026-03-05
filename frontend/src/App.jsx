import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import LobbyPage from './pages/LobbyPage.jsx';
import GamePage from './pages/GamePage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import PlayerProfilePage from './pages/PlayerProfilePage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';

const App = () => {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/game/:gameId" element={<GamePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/leaderboard/:username" element={<PlayerProfilePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </>
  );
};

export default App;
