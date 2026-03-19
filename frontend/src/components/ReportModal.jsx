import { useState } from 'react';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const REASONS = [
  { value: 'engine_use', label: 'Engine / Computer Use' },
  { value: 'stalling', label: 'Stalling / Wasting Time' },
  { value: 'harassment', label: 'Harassment / Abuse' },
  { value: 'other', label: 'Other' },
];

const ReportModal = ({ opponentId, gameId, onClose }) => {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState(null); // null | 'submitting' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async () => {
    if (!reason) return;
    setStatus('submitting');

    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/fairplay/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reportedId: opponentId,
          gameId,
          reason,
          details: details.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit report');
      }

      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '420px',
          padding: '24px',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}
      >
        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>
          Report Player
        </h3>

        {status === 'success' ? (
          <div>
            <p style={{ color: 'var(--accent-text)', marginBottom: '16px' }}>
              Report submitted successfully. Our team will review it.
            </p>
            <button className="btn btn-primary btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Reason
              </label>
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 0',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  {r.label}
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Details (optional)
              </label>
              <textarea
                className="input"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Additional context..."
                style={{ width: '100%', resize: 'vertical', fontSize: '13px' }}
              />
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'right' }}>
                {details.length}/500
              </div>
            </div>

            {status === 'error' && (
              <div style={{
                padding: '8px 12px',
                marginBottom: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(229,57,53,0.12)',
                color: '#ef5350',
                fontSize: '13px',
              }}>
                {errorMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleSubmit}
                disabled={!reason || status === 'submitting'}
              >
                {status === 'submitting' ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportModal;
