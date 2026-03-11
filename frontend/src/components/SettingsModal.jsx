import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { AVATAR_MAP, AVATAR_OPTIONS } from '../utils/avatars.js';
import { BOARD_THEMES, THEME_KEYS } from '../utils/boardThemes.js';
import LinkedAccounts from './LinkedAccounts.jsx';

const SettingsModal = ({ onClose }) => {
  const { user, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(
    user?.username || localStorage.getItem('chess_player_name') || ''
  );
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar_id || 'default');
  const [selectedTheme, setSelectedTheme] = useState(
    () => localStorage.getItem('chess_board_theme') || user?.board_theme || 'default'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    setSuccess(false);

    // Always persist theme to localStorage for immediate use
    localStorage.setItem('chess_board_theme', selectedTheme);

    if (user) {
      setSaving(true);
      try {
        await updateProfile(displayName, selectedAvatar, selectedTheme);
        setSuccess(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    } else {
      localStorage.setItem('chess_player_name', displayName);
      setSuccess(true);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left', maxWidth: '480px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '20px', fontWeight: 700 }}>
          Settings
        </h2>

        {error && <div className="form-error">{error}</div>}
        {success && (
          <div style={{
            marginBottom: '12px',
            padding: '10px 16px',
            background: 'rgba(124, 179, 66, 0.12)',
            border: '1px solid rgba(124, 179, 66, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-text)',
            fontSize: '13px',
            textAlign: 'center',
          }}>
            Settings saved
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Display Name</label>
          <input
            className="input"
            type="text"
            placeholder="Your display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        {user && (
          <div className="form-group">
            <label className="form-label">Avatar</label>
            <div className="avatar-grid">
              {AVATAR_OPTIONS.map((id) => (
                <button
                  key={id}
                  className={`avatar-option${selectedAvatar === id ? ' selected' : ''}`}
                  onClick={() => setSelectedAvatar(id)}
                  title={id.replace(/_/g, ' ')}
                  type="button"
                >
                  {AVATAR_MAP[id]}
                </button>
              ))}
            </div>
          </div>
        )}

        {user && <LinkedAccounts />}

        <div className="form-group">
          <label className="form-label">Board Theme</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
            {THEME_KEYS.map((key) => {
              const theme = BOARD_THEMES[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedTheme(key)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 'var(--radius-sm)',
                    border: selectedTheme === key ? '2px solid var(--accent)' : '2px solid transparent',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ background: theme.lightSquare }} />
                    <div style={{ background: theme.darkSquare }} />
                    <div style={{ background: theme.darkSquare }} />
                    <div style={{ background: theme.lightSquare }} />
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{theme.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 1 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
