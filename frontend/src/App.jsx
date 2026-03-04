import React from 'react';
import { Routes, Route } from 'react-router-dom';
import LobbyPage from './pages/LobbyPage.jsx';
import GamePage from './pages/GamePage.jsx';

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<LobbyPage />} />
      <Route path="/game/:gameId" element={<GamePage />} />
    </Routes>
  );
};

export default App;
