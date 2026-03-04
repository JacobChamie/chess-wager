import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket.js';

const TIME_OPTIONS = [
  { label: '1 min', value: 60 },
  { label: '3 min', value: 180 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
];

const LobbyPage = () => {
  const navigate = useNavigate();

  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('chess_player_name') || ''
  );
  const [timeControl, setTimeControl] = useState(300);
  const [status, setStatus] = useState('idle'); // idle | queued | creating | waiting
  const [pendingGameId, setPendingGameId] = useState(null);
  const [joinGameId, setJoinGameId] = useState('');
  const [error, setError] = useState(null);

  const getName = useCallback(
    () => playerName.trim() || 'Anonymous',
    [playerName]
  );

  useEffect(() => {
    socket.connect();

    socket.on('lobby:queued', () => {
      setStatus('queued');
    });

    socket.on('lobby:game_created', ({ gameId }) => {
      setPendingGameId(gameId);
      setStatus('waiting');
    });

    socket.on('lobby:game_start', ({ gameId }) => {
      navigate(`/game/${gameId}`);
    });

    socket.on('lobby:error', ({ message }) => {
      setError(message);
      setStatus('idle');
    });

    return () => {
      socket.off('lobby:queued');
      socket.off('lobby:game_created');
      socket.off('lobby:game_start');
      socket.off('lobby:error');
    };
  }, [navigate]);

  const handlePlay = () => {
    setError(null);
    localStorage.setItem('chess_player_name', getName());
    socket.emit('lobby:play', {
      timeControl,
      playerName: getName(),
    });
    setStatus('queued');
  };

  const handleCancelPlay = () => {
    socket.emit('lobby:cancel_play', {});
    setStatus('idle');
  };

  const handleCreateGame = () => {
    setError(null);
    localStorage.setItem('chess_player_name', getName());
    socket.emit('lobby:create_game', {
      timeControl,
      playerName: getName(),
    });
    setStatus('creating');
  };

  const handleJoinGame = () => {
    if (!joinGameId.trim()) return;
    setError(null);
    localStorage.setItem('chess_player_name', getName());

    // Extract game ID from URL or raw ID
    let id = joinGameId.trim();
    const match = id.match(/\/game\/([^/]+)/);
    if (match) id = match[1];

    socket.emit('lobby:join_game', {
      gameId: id,
      playerName: getName(),
    });
  };

  const copyGameLink = () => {
    const link = `${window.location.origin}/game/${pendingGameId}`;
    navigator.clipboard.writeText(link).catch(() => {});
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1e1e1e',
        color: '#f5f5f5',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', marginBottom: '40px' }}>Chess Wager</h1>

      {/* Player name */}
      <div style={{ marginBottom: '24px', width: '320px' }}>
        <input
          type="text"
          placeholder="Your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            borderRadius: '8px',
            border: '1px solid #555',
            backgroundColor: '#2a2a2a',
            color: '#fff',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Time control */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '32px',
        }}
      >
        {TIME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTimeControl(opt.value)}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor:
                timeControl === opt.value ? '#4caf50' : '#333',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: timeControl === opt.value ? 'bold' : 'normal',
              fontSize: '14px',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            marginBottom: '16px',
            color: '#e53935',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {status === 'idle' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '320px',
          }}
        >
          {/* Play button */}
          <button
            onClick={handlePlay}
            style={{
              padding: '14px',
              fontSize: '18px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: '#4caf50',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Play
          </button>

          {/* Create game link */}
          <button
            onClick={handleCreateGame}
            style={{
              padding: '14px',
              fontSize: '16px',
              borderRadius: '10px',
              border: '1px solid #555',
              backgroundColor: '#2a2a2a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Create Game Link
          </button>

          {/* Join game */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Game ID or link"
              value={joinGameId}
              onChange={(e) => setJoinGameId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '14px',
                borderRadius: '8px',
                border: '1px solid #555',
                backgroundColor: '#2a2a2a',
                color: '#fff',
                outline: 'none',
              }}
            />
            <button
              onClick={handleJoinGame}
              style={{
                padding: '12px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4caf50',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Join
            </button>
          </div>
        </div>
      )}

      {status === 'queued' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '18px', marginBottom: '16px' }}>
            Searching for opponent...
          </p>
          <button
            onClick={handleCancelPlay}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#e53935',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {status === 'waiting' && pendingGameId && (
        <div style={{ textAlign: 'center', width: '400px' }}>
          <p style={{ fontSize: '18px', marginBottom: '12px' }}>
            Waiting for opponent to join...
          </p>
          <div
            style={{
              backgroundColor: '#2a2a2a',
              padding: '12px',
              borderRadius: '8px',
              marginBottom: '12px',
              fontSize: '14px',
              wordBreak: 'break-all',
            }}
          >
            {window.location.origin}/game/{pendingGameId}
          </div>
          <button
            onClick={copyGameLink}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#4caf50',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Copy Link
          </button>
        </div>
      )}

      {status === 'creating' && (
        <p style={{ fontSize: '18px' }}>Creating game...</p>
      )}
    </div>
  );
};

export default LobbyPage;
