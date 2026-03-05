import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAvatar } from '../utils/avatars.js';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const RANK_BADGES = { 1: '\uD83E\uDD47', 2: '\uD83E\uDD48', 3: '\uD83E\uDD49' };

const LeaderboardPage = () => {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/leaderboard`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((data) => setPlayers(data.players))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 20px' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
        {error}
      </div>
    );
  }

  return (
    <div className="leaderboard-container">
      <h1 className="leaderboard-title">Leaderboard</h1>
      {players.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px 0' }}>
          No players yet. Play a game to appear here!
        </p>
      ) : (
        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Rating</th>
                <th>W</th>
                <th>L</th>
                <th>D</th>
                <th>Games</th>
                <th>Win %</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td className="lb-rank">
                    {RANK_BADGES[p.rank] || p.rank}
                  </td>
                  <td>
                    <Link to={`/leaderboard/${p.username}`} className="lb-player-link">
                      <span className="lb-avatar">{getAvatar(p.avatarId)}</span>
                      {p.username}
                    </Link>
                  </td>
                  <td className="lb-rating">{p.rating}</td>
                  <td className="lb-win">{p.wins}</td>
                  <td className="lb-loss">{p.losses}</td>
                  <td className="lb-draw">{p.draws}</td>
                  <td>{p.games}</td>
                  <td>{p.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LeaderboardPage;
