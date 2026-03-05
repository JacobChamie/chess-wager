import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(token ? 'form' : 'error'); // form | loading | success | error
  const [message, setMessage] = useState(token ? '' : 'No reset token provided');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setMessage('Passwords do not match');
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setStatus('success');
      } else {
        setStatus('form');
        setMessage(data.error || 'Reset failed');
      }
    } catch {
      setStatus('form');
      setMessage('Network error — please try again');
    }
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 52px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '40px',
        maxWidth: '420px',
        width: '100%',
        textAlign: 'left',
      }}>
        {status === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u274C'}</div>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>Invalid Link</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>{message}</p>
            <Link to="/" className="btn btn-ghost">Go to Lobby</Link>
          </div>
        )}

        {status === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u2705'}</div>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>Password Reset!</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Your password has been updated. You can now sign in.
            </p>
            <Link to="/" className="btn btn-primary">Go to Lobby</Link>
          </div>
        )}

        {(status === 'form' || status === 'loading') && (
          <>
            <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Set New Password
            </h2>

            {message && <div className="form-error">{message}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <button
                className="btn btn-primary btn-lg"
                type="submit"
                disabled={status === 'loading'}
                style={{ width: '100%', marginTop: '8px' }}
              >
                {status === 'loading' ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
