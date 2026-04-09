import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const BENEFITS = [
  { icon: '\u2728', title: 'Gold Username', desc: 'Stand out with a gold name and star badge everywhere', active: true },
  { icon: '\u26A1', title: 'Priority Matchmaking', desc: 'Get matched first when seeking games', active: true },
  { icon: '\uD83D\uDCB8', title: '0% Withdrawal Fee', desc: 'No rake on token withdrawals', active: true },
  { icon: '\u23E9', title: 'Instant Withdrawals', desc: 'Skip admin approval — withdrawals process immediately', active: true },
  { icon: '\uD83C\uDF99\uFE0F', title: 'Voice Chat', desc: 'Talk to your opponent during games', coming: true },
  { icon: '\uD83C\uDFC6', title: 'Freeroll Tournaments', desc: 'Enter premium-only tournaments with token prizes', coming: true },
];

const PremiumPage = () => {
  const { user, refreshUser, mergeUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchStatus = useCallback(async () => {
    const token = localStorage.getItem('chess_token');
    if (!token) { setLoading(false); return; }
    try {
      const res = await fetch(`${API_URL}/api/premium/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSubscribe = async () => {
    setError(null);
    setSuccess(null);
    setSubscribing(true);
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/premium/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Subscription failed');
      setSuccess('Premium activated!');
      setStatus((prev) => ({
        ...prev,
        isPremium: true,
        expiresAt: data.expiresAt,
        balance: data.newBalance,
      }));
      mergeUser({
        is_premium: true,
        premium_expires_at: data.expiresAt,
        token_balance: data.newBalance,
      });
      refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubscribing(false);
    }
  };

  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 52px)' }}>
        <div className="modal-card" style={{ maxWidth: '400px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Premium</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Sign in to view premium benefits.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 52px)' }}>
        <div className="spinner" />
      </div>
    );
  }

  const isPremium = status?.isPremium;
  const expiresAt = status?.expiresAt ? new Date(status.expiresAt) : null;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 16px', minHeight: 'calc(100vh - 52px)' }}>
      <div style={{ maxWidth: '480px', width: '100%' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, textAlign: 'center', marginBottom: '4px' }}>
          <span style={{ color: '#ffd700' }}>{'\u2605'}</span> Premium
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
          $15/month in tokens
        </p>

        {/* Status banner */}
        {isPremium && (
          <div style={{
            background: 'rgba(255, 215, 0, 0.1)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            marginBottom: '20px',
            textAlign: 'center',
          }}>
            <div style={{ color: '#ffd700', fontWeight: 700, fontSize: '15px' }}>
              {'\u2605'} Premium Active
            </div>
            {expiresAt && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                Expires {expiresAt.toLocaleDateString()}
              </div>
            )}
          </div>
        )}

        {error && <div className="form-error" style={{ marginBottom: '12px' }}>{error}</div>}
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
            {success}
          </div>
        )}

        {/* Benefits */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                opacity: b.coming ? 0.5 : 1,
              }}
            >
              <span style={{ fontSize: '22px', flexShrink: 0 }}>{b.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>
                  {b.title}
                  {b.coming && (
                    <span style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255,255,255,0.08)',
                      color: 'var(--text-secondary)',
                      marginLeft: '6px',
                    }}>
                      COMING SOON
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {b.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Subscribe button */}
        <button
          className="btn btn-primary"
          onClick={handleSubscribe}
          disabled={subscribing}
          style={{
            width: '100%',
            padding: '14px',
            fontSize: '16px',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #ffd700, #ffaa00)',
            color: '#000',
            border: 'none',
          }}
        >
          {subscribing
            ? 'Processing...'
            : isPremium
              ? 'Extend 30 Days — 15 tokens'
              : 'Go Premium — 15 tokens'}
        </button>

        {status && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', marginTop: '8px' }}>
            Current balance: {status.balance?.toFixed(2) ?? '—'} tokens
          </div>
        )}
      </div>
    </div>
  );
};

export default PremiumPage;
