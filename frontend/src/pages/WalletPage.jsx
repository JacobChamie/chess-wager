import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import DepositForm from '../components/DepositForm.jsx';
import WithdrawForm from '../components/WithdrawForm.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const WalletPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('deposit');
  const [balance, setBalance] = useState(null);
  const [pendingDeposits, setPendingDeposits] = useState(0);
  const [ledger, setLedger] = useState([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);

  const fetchBalance = useCallback(async () => {
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance);
        setPendingDeposits(data.pendingDeposits);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchLedger = useCallback(async () => {
    try {
      const token = localStorage.getItem('chess_token');
      const res = await fetch(`${API_URL}/api/crypto/ledger?page=${ledgerPage}&limit=15`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLedger(data.entries || []);
        setLedgerTotal(data.total || 0);
      }
    } catch { /* ignore */ }
  }, [ledgerPage]);

  useEffect(() => {
    if (!user) {
      navigate('/');
      return;
    }
    fetchBalance();
  }, [user, navigate, fetchBalance]);

  useEffect(() => {
    if (tab === 'history') fetchLedger();
  }, [tab, ledgerPage, fetchLedger]);

  // Poll balance every 15s
  useEffect(() => {
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  if (!user) return null;

  const displayBalance = balance !== null ? balance : parseFloat(user.token_balance) || 0;

  return (
    <div style={{
      minHeight: 'calc(100vh - 52px)',
      background: 'var(--bg-base)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 16px',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: '480px', padding: '0' }}>
        {/* Balance header */}
        <div style={{
          padding: '24px 28px 16px',
          textAlign: 'center',
          borderBottom: '1px solid var(--border)',
        }}>
          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>
            Token Balance
          </p>
          <p style={{ fontSize: '36px', fontWeight: 800, color: '#ffd700', lineHeight: 1.2 }}>
            {displayBalance.toFixed(2)}
          </p>
          {pendingDeposits > 0 && (
            <p style={{ fontSize: '12px', color: '#ffa726', marginTop: '4px' }}>
              {pendingDeposits} deposit{pendingDeposits > 1 ? 's' : ''} pending
            </p>
          )}
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          <button className={tab === 'deposit' ? 'active' : ''} onClick={() => setTab('deposit')}>
            Deposit
          </button>
          <button className={tab === 'withdraw' ? 'active' : ''} onClick={() => setTab('withdraw')}>
            Withdraw
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History
          </button>
        </div>

        <div style={{ padding: '0 28px 28px' }}>
          {tab === 'deposit' && <DepositForm />}
          {tab === 'withdraw' && (
            <WithdrawForm onBalanceChange={(newBal) => setBalance(newBal)} />
          )}
          {tab === 'history' && (
            <div>
              {ledger.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0', fontSize: '14px' }}>
                  No transactions yet
                </p>
              ) : (
                <>
                  {ledger.map((entry) => (
                    <div key={entry.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 0', borderBottom: '1px solid var(--border)',
                    }}>
                      <div>
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                          background: entry.type.includes('win') || entry.type === 'deposit' || entry.type === 'wager_refund'
                            ? 'rgba(76, 175, 80, 0.15)' : 'rgba(229, 57, 53, 0.15)',
                          color: entry.type.includes('win') || entry.type === 'deposit' || entry.type === 'wager_refund'
                            ? '#66bb6a' : '#ef5350',
                        }}>
                          {entry.type.replace('_', ' ')}
                        </span>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.description}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{
                          fontSize: '14px', fontWeight: 600,
                          color: parseFloat(entry.amount) >= 0 ? '#66bb6a' : '#ef5350',
                        }}>
                          {parseFloat(entry.amount) >= 0 ? '+' : ''}{parseFloat(entry.amount).toFixed(2)}
                        </span>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Bal: {parseFloat(entry.balance_after).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Pagination */}
                  {ledgerTotal > 15 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={ledgerPage <= 1}
                        onClick={() => setLedgerPage((p) => p - 1)}
                      >
                        Prev
                      </button>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '6px 0' }}>
                        {ledgerPage} / {Math.ceil(ledgerTotal / 15)}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={ledgerPage >= Math.ceil(ledgerTotal / 15)}
                        onClick={() => setLedgerPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletPage;
