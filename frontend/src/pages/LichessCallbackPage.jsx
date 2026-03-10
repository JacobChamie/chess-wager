import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const LichessCallbackPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Connecting to Lichess...');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const token = localStorage.getItem('chess_token');

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization code. Please try again.');
      return;
    }

    if (!token) {
      setStatus('error');
      setMessage('You must be logged in to link your Lichess account.');
      return;
    }

    fetch(`${API_URL}/api/linked/lichess/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          setStatus('success');
          setMessage(`Lichess account "${data.username}" linked successfully!`);
          setTimeout(() => navigate('/'), 2000);
        } else {
          setStatus('error');
          setMessage(data.error || 'Failed to link Lichess account.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Failed to connect. Please try again.');
      });
  }, [searchParams, navigate]);

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: 'calc(100vh - 52px)', padding: '20px',
    }}>
      <div className="modal-card" style={{ textAlign: 'center', maxWidth: '400px' }}>
        {status === 'loading' && <div className="spinner" style={{ margin: '0 auto 16px' }} />}
        {status === 'success' && (
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#9813;</div>
        )}
        {status === 'error' && (
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#9888;</div>
        )}
        <p style={{
          color: status === 'error' ? '#e53935' : status === 'success' ? '#7cb342' : 'var(--text-primary)',
          fontSize: '14px',
        }}>
          {message}
        </p>
        {status === 'error' && (
          <button className="btn btn-ghost" onClick={() => navigate('/')} style={{ marginTop: '12px' }}>
            Back to Lobby
          </button>
        )}
      </div>
    </div>
  );
};

export default LichessCallbackPage;
