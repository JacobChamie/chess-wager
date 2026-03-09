import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const DepositForm = () => {
  const [chain, setChain] = useState('ethereum');
  const [address, setAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [deposits, setDeposits] = useState([]);
  const [assetsInfo, setAssetsInfo] = useState([]);

  const getAddress = async (selectedChain) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/deposit/address`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chain: selectedChain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAddress(data.address);
      setAssetsInfo(data.assets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeposits = async () => {
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/deposits?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDeposits(data.deposits || []);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    getAddress(chain);
    fetchDeposits();
    // Poll deposits every 30s
    const interval = setInterval(fetchDeposits, 30000);
    return () => clearInterval(interval);
  }, [chain]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      {/* Chain selector */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
          Network
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { value: 'ethereum', label: 'Ethereum', icon: '\u039E' },
            { value: 'solana', label: 'Solana', icon: '\u25CE' },
          ].map((opt) => (
            <button
              key={opt.value}
              className={`btn btn-sm${chain === opt.value ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => { setChain(opt.value); setAddress(null); }}
              style={{ flex: 1 }}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '16px', padding: '10px 16px', background: 'rgba(229, 57, 53, 0.12)', border: '1px solid rgba(229, 57, 53, 0.3)', borderRadius: 'var(--radius-sm)', color: '#ef5350', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Generating deposit address...</p>
        </div>
      )}

      {address && !loading && (
        <>
          {/* QR Code */}
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'inline-block', padding: '12px', background: '#fff', borderRadius: 'var(--radius)' }}>
              <QRCodeSVG value={address} size={180} />
            </div>
          </div>

          {/* Address */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Deposit Address
            </label>
            <div style={{
              background: 'var(--bg-base)', border: '1px solid var(--border)', padding: '10px 12px',
              borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: '12px',
              wordBreak: 'break-all', color: 'var(--text-primary)',
            }}>
              {address}
            </div>
            <button className="btn btn-primary btn-sm" onClick={copyAddress} style={{ marginTop: '8px', width: '100%' }}>
              {copied ? 'Copied!' : 'Copy Address'}
            </button>
          </div>

          {/* Accepted assets */}
          {assetsInfo.length > 0 && (
            <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <p style={{ fontWeight: 600, marginBottom: '4px' }}>Accepted on this address:</p>
              {assetsInfo.map((a) => (
                <div key={a.asset} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{a.asset.replace('_', ' ')}</span>
                  <span style={{ color: 'var(--text-muted)' }}>min {a.minDeposit}</span>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Send {chain === 'ethereum' ? 'ETH or USDC (ERC-20)' : 'SOL or USDC (SPL)'} to this address.
            Tokens are credited at 1 USD = 1 token after confirmations.
          </p>
        </>
      )}

      {/* Recent deposits */}
      {deposits.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Recent Deposits</h4>
          {deposits.map((d) => (
            <div key={d.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: '13px',
            }}>
              <div>
                <span style={{ fontWeight: 600 }}>{parseFloat(d.amount_decimal).toFixed(4)} {d.asset.replace('_', ' ')}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>+{parseFloat(d.tokens_credited).toFixed(2)} tokens</span>
              </div>
              <span style={{
                fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                background: d.status === 'credited' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255, 152, 0, 0.15)',
                color: d.status === 'credited' ? '#66bb6a' : '#ffa726',
              }}>
                {d.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DepositForm;
