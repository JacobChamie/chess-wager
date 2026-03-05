import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const AuthModal = ({ onClose }) => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // login | register | forgot
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
        onClose();
      } else if (mode === 'register') {
        await register(username, email, password);
        setSuccessMessage('Account created! Check your email for a verification link.');
        setTimeout(onClose, 2500);
      } else if (mode === 'forgot') {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        setSuccessMessage(data.message || 'If an account with that email exists, a reset link has been sent.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Reset Password';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'left' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '20px', fontWeight: 700 }}>
          {title}
        </h2>

        {mode !== 'forgot' && (
          <div className="auth-toggle">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(null); setSuccessMessage(null); }}>
              Sign In
            </button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(null); setSuccessMessage(null); }}>
              Register
            </button>
          </div>
        )}

        {mode === 'forgot' && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setMode('login'); setError(null); setSuccessMessage(null); }}
            style={{ marginBottom: '12px', fontSize: '13px' }}
          >
            Back to Sign In
          </button>
        )}

        {error && <div className="form-error">{error}</div>}
        {successMessage && (
          <div style={{
            padding: '10px 14px', marginBottom: '12px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(76, 175, 80, 0.12)', border: '1px solid rgba(76, 175, 80, 0.3)',
            color: '#66bb6a', fontSize: '13px',
          }}>
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode !== 'forgot' && (
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="input"
                type="text"
                placeholder={mode === 'login' ? 'Enter your username' : 'Choose a username'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={32}
              />
            </div>
          )}

          {(mode === 'register' || mode === 'forgot') && (
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          )}

          {mode !== 'forgot' && (
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="input"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: '8px' }}>
              <span
                style={{ fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                onClick={() => { setMode('forgot'); setError(null); setSuccessMessage(null); }}
              >
                Forgot password?
              </span>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            type="submit"
            disabled={loading}
            style={{ width: '100%', marginTop: '8px' }}
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In'
                : mode === 'register'
                  ? 'Create Account'
                  : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuthModal;
