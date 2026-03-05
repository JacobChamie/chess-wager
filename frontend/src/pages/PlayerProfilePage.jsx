import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getAvatar } from '../utils/avatars.js';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const RESULT_COLORS = { win: '#7cb342', loss: '#e53935', draw: '#a0a0a0' };

const PlayerProfilePage = () => {
  const { username } = useParams();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [recentGames, setRecentGames] = useState([]);
  const [h2h, setH2h] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setH2h(null);

    fetch(`${API_URL}/api/leaderboard/players/${encodeURIComponent(username)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Player not found'))))
      .then((data) => {
        setProfile(data.player);
        setRecentGames(data.recentGames);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [username]);

  // Fetch head-to-head if viewing another player while logged in
  useEffect(() => {
    if (!currentUser || !profile || currentUser.username === username) return;
    fetch(`${API_URL}/api/leaderboard/players/${encodeURIComponent(username)}/vs/${encodeURIComponent(currentUser.username)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setH2h(data); })
      .catch(() => {});
  }, [currentUser, profile, username]);

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
    <div className="profile-container">
      {/* Header */}
      <div className="profile-header">
        <div className="profile-avatar-large">{getAvatar(profile.avatarId)}</div>
        <div className="profile-info">
          <h1 className="profile-username">{profile.username}</h1>
          <div className="profile-rating-badge">{profile.rating} ELO</div>
          <div className="profile-joined">
            Member since {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="profile-stats-row">
        <div className="profile-stat">
          <span className="profile-stat-value">{profile.games}</span>
          <span className="profile-stat-label">Games</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value" style={{ color: '#7cb342' }}>{profile.wins}</span>
          <span className="profile-stat-label">Wins</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value" style={{ color: '#e53935' }}>{profile.losses}</span>
          <span className="profile-stat-label">Losses</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{profile.draws}</span>
          <span className="profile-stat-label">Draws</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{profile.winRate}%</span>
          <span className="profile-stat-label">Win Rate</span>
        </div>
      </div>

      {/* Head-to-head */}
      {h2h && h2h.games > 0 && (
        <div className="profile-section">
          <h2 className="profile-section-title">Head-to-Head vs You</h2>
          <div className="profile-h2h">
            <span style={{ color: '#e53935', fontWeight: 700 }}>{h2h.wins} W</span>
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <span>{h2h.draws} D</span>
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <span style={{ color: '#7cb342', fontWeight: 700 }}>{h2h.opponentWins} L</span>
            <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>
              ({h2h.games} game{h2h.games !== 1 ? 's' : ''})
            </span>
          </div>
        </div>
      )}

      {/* Recent Games */}
      <div className="profile-section">
        <h2 className="profile-section-title">Recent Games</h2>
        {recentGames.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No games played yet.</p>
        ) : (
          <div className="profile-games-list">
            {recentGames.map((g) => (
              <div key={g.id} className="profile-game-row">
                <span
                  className="profile-game-result"
                  style={{ color: RESULT_COLORS[g.result] }}
                >
                  {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                </span>
                <span className="profile-game-opponent">vs {g.opponent || 'Anonymous'}</span>
                <span className="profile-game-reason">{g.reason?.replace(/_/g, ' ')}</span>
                <span className="profile-game-date">
                  {g.endedAt ? new Date(g.endedAt).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', marginTop: '24px' }}>
        <Link to="/leaderboard" className="btn btn-ghost btn-sm">
          Back to Leaderboard
        </Link>
      </div>
    </div>
  );
};

export default PlayerProfilePage;
