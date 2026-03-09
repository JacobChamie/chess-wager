import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const ASSETS = {
  ethereum: [
    { value: 'ETH', label: 'ETH' },
    { value: 'USDC_ERC20', label: 'USDC (ERC-20)' },
  ],
  solana: [
    { value: 'SOL', label: 'SOL' },
    { value: 'USDC_SPL', label: 'USDC (SPL)' },
  ],
};

const WithdrawForm = ({ onBalanceChange }) => {
  const { user } = useAuth();
  const balance = parseFloat(user?.token_balance) || 0;

  const [chain, setChain] = useState('ethereum');
  const [asset, setAsset] = useState('ETH');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);

  useEffect(() => {
    // Update asset when chain changes
    setAsset(ASSETS[chain][0].value);
  }, [chain]);

  useEffect(() => {
    fetchPrices();
    fetchWithdrawals();
  }, []);

  const fetchPrices = async () => {
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/prices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setPrices(await res.json());
    } catch { /* ignore */ }
  };

  const fetchWithdrawals = async () => {
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/withdrawals?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWithdrawals(data.withdrawals || []);
      }
    } catch { /* ignore */ }
  };

  const amountNum = parseFloat(amount) || 0;
  const priceKey = asset === 'USDC_ERC20' || asset === 'USDC_SPL' ? 'USDC' : asset;
  const price = prices[priceKey] || 0;
  const cryptoAmount = price > 0 ? amountNum / price : 0;

  const handleWithdraw = async () => {
    setError(null);
    setSuccess(null);

    if (!toAddress.trim()) return setError('Enter destination address');
    if (amountNum <= 0) return setError('Enter a valid amount');
    if (amountNum > balance) return setError('Insufficient balance');

    setLoading(true);
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chain, asset, to_address: toAddress.trim(), amount_tokens: amountNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess(`Withdrawal queued! ${data.amountCrypto.toFixed(6)} ${asset} to ${toAddress.slice(0, 10)}...`);
      setAmount('');
      setToAddress('');
      onBalanceChange?.(data.newBalance);
      fetchWithdrawals();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Chain selector */}
      <div style={{ marginBottom: '16px' }}>
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
              onClick={() => setChain(opt.value)}
              style={{ flex: 1 }}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Asset selector */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
          Asset
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {ASSETS[chain].map((a) => (
            <button
              key={a.value}
              className={`btn btn-sm${asset === a.value ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => setAsset(a.value)}
              style={{ flex: 1 }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Destination address */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
          Destination Address
        </label>
        <input
          className="input"
          type="text"
          placeholder={chain === 'ethereum' ? '0x...' : 'Solana address...'}
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
        />
      </div>

      {/* Amount */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
          Amount (tokens)
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="input"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setAmount(balance.toString())}
            style={{ whiteSpace: 'nowrap' }}
          >
            Max ({balance.toFixed(2)})
          </button>
        </div>
        {cryptoAmount > 0 && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {'\u2248'} {cryptoAmount.toFixed(6)} {asset.replace('_', ' ')}
          </p>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '12px', padding: '10px 16px', background: 'rgba(229, 57, 53, 0.12)', border: '1px solid rgba(229, 57, 53, 0.3)', borderRadius: 'var(--radius-sm)', color: '#ef5350', fontSize: '14px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom: '12px', padding: '10px 16px', background: 'rgba(76, 175, 80, 0.12)', border: '1px solid rgba(76, 175, 80, 0.3)', borderRadius: 'var(--radius-sm)', color: '#66bb6a', fontSize: '14px' }}>
          {success}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleWithdraw}
        disabled={loading || amountNum <= 0}
        style={{ width: '100%' }}
      >
        {loading ? 'Processing...' : 'Withdraw'}
      </button>

      {/* Recent withdrawals */}
      {withdrawals.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Recent Withdrawals</h4>
          {withdrawals.map((w) => (
            <div key={w.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: '13px',
            }}>
              <div>
                <span style={{ fontWeight: 600 }}>{parseFloat(w.amount_tokens).toFixed(2)} tokens</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>{'\u2192'} {w.to_address.slice(0, 8)}...</span>
              </div>
              <span style={{
                fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                background: w.status === 'confirmed' ? 'rgba(76, 175, 80, 0.15)' : w.status === 'failed' ? 'rgba(229, 57, 53, 0.15)' : 'rgba(255, 152, 0, 0.15)',
                color: w.status === 'confirmed' ? '#66bb6a' : w.status === 'failed' ? '#ef5350' : '#ffa726',
              }}>
                {w.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WithdrawForm;
