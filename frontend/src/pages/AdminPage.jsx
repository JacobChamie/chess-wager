import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const AdminPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteGameId, setDeleteGameId] = useState('');
  const [message, setMessage] = useState(null);

  const token = localStorage.getItem('chess_token');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (user?.is_admin) fetchUsers();
    else setLoading(false);
  }, [user, fetchUsers]);

  const showMsg = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const adminAction = async (url, method = 'PUT') => {
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    } catch (err) {
      showMsg('error', err.message);
      return null;
    }
  };

  const handleBan = async (userId) => {
    const data = await adminAction(`${API_URL}/api/admin/users/${userId}/ban`);
    if (data) {
      showMsg('success', `${data.user.username} ${data.user.is_banned ? 'banned' : 'unbanned'}`);
      fetchUsers();
    }
  };

  const handleResetRating = async (userId) => {
    const data = await adminAction(`${API_URL}/api/admin/users/${userId}/reset-rating`);
    if (data) {
      showMsg('success', `${data.user.username} rating reset to 1200`);
      fetchUsers();
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    const data = await adminAction(`${API_URL}/api/admin/users/${userId}`, 'DELETE');
    if (data) {
      showMsg('success', 'User deleted');
      fetchUsers();
    }
  };

  const handleDeleteGame = async () => {
    const id = deleteGameId.trim();
    if (!id) return;
    const data = await adminAction(`${API_URL}/api/admin/games/${id}`, 'DELETE');
    if (data) {
      showMsg('success', `Game ${id} deleted`);
      setDeleteGameId('');
    }
  };

  if (!user?.is_admin) {
    return (
      <div className="admin-container">
        <h2>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)' }}>You do not have admin privileges.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-container" style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '40px auto' }} />
      </div>
    );
  }

  return (
    <div className="admin-container">
      <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '20px' }}>Admin Panel</h2>

      {message && (
        <div
          style={{
            padding: '10px 16px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-sm)',
            background: message.type === 'error' ? 'rgba(229,57,53,0.12)' : 'rgba(124,179,66,0.12)',
            color: message.type === 'error' ? '#ef5350' : 'var(--accent-text)',
            fontSize: '13px',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Delete game */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          className="input input-sm"
          placeholder="Game ID to delete"
          value={deleteGameId}
          onChange={(e) => setDeleteGameId(e.target.value)}
          style={{ maxWidth: '240px' }}
        />
        <button className="btn btn-danger btn-sm" onClick={handleDeleteGame}>
          Delete Game
        </button>
      </div>

      {/* Users table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="leaderboard-table" style={{ minWidth: '600px' }}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Rating</th>
              <th>Games</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>
                  {u.username}
                  {u.is_admin && <span style={{ color: 'var(--accent)', marginLeft: '6px', fontSize: '12px' }}>ADMIN</span>}
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{u.email}</td>
                <td className="lb-rating">{u.rating}</td>
                <td>{u.game_count}</td>
                <td>
                  {u.is_banned ? (
                    <span style={{ color: '#ef5350', fontWeight: 600, fontSize: '12px' }}>BANNED</span>
                  ) : (
                    <span style={{ color: 'var(--accent-text)', fontSize: '12px' }}>Active</span>
                  )}
                </td>
                <td>
                  {u.id !== user.id && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <button
                        className={`btn btn-sm ${u.is_banned ? 'btn-primary' : 'btn-danger'}`}
                        onClick={() => handleBan(u.id)}
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                      >
                        {u.is_banned ? 'Unban' : 'Ban'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleResetRating(u.id)}
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                      >
                        Reset Rating
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteUser(u.id, u.username)}
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminPage;
