import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided');
      return;
    }

    fetch(`${API_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          setStatus('success');
          setMessage(`Email verified successfully! Welcome, ${data.username}.`);
        } else {
          setStatus('error');
          setMessage(data.error || 'Verification failed');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error — please try again');
      });
  }, [searchParams]);

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
        textAlign: 'center',
      }}>
        {status === 'verifying' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-secondary)' }}>Verifying your email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u2705'}</div>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>Verified!</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>{message}</p>
            <Link to="/" className="btn btn-primary">Go to Lobby</Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u274C'}</div>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: '12px' }}>Verification Failed</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>{message}</p>
            <Link to="/" className="btn btn-ghost">Go to Lobby</Link>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmailPage;
