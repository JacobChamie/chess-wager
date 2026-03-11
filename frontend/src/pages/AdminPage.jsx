import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const TIME_CONTROLS = [
  { label: '1+0 Bullet', value: { time: 60, increment: 0 } },
  { label: '3+0 Blitz', value: { time: 180, increment: 0 } },
  { label: '5+0 Blitz', value: { time: 300, increment: 0 } },
  { label: '10+0 Rapid', value: { time: 600, increment: 0 } },
];

const DELAY_OPTIONS = [
  { label: 'Fast (200ms)', value: 200 },
  { label: 'Normal (500ms)', value: 500 },
  { label: 'Slow (1000ms)', value: 1000 },
];

const AdminPage = () => {
  const { user } = useAuth();
  const [adminTab, setAdminTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteGameId, setDeleteGameId] = useState('');
  const [message, setMessage] = useState(null);

  // Withdrawal approval state
  const [pendingWithdrawals, setPendingWithdrawals] = useState([]);
  const [wdLoading, setWdLoading] = useState(false);
  const [rejectReasons, setRejectReasons] = useState({});

  // Transaction browser state
  const [transactions, setTransactions] = useState([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);
  const [txFilter, setTxFilter] = useState('all');
  const [txLoading, setTxLoading] = useState(false);
  const [reverseReasons, setReverseReasons] = useState({});

  // Stress test state
  const [stConfig, setStConfig] = useState({
    botCount: 6,
    timeControlIdx: 1, // 3+0 Blitz
    movesBeforeEnd: 6,
    endMethod: 'mixed',
    rounds: 3,
    delayIdx: 1, // Normal 500ms
  });
  const [stStatus, setStStatus] = useState({ running: false, log: [], gamesPlayed: 0, currentRound: 0, totalRounds: 0 });
  const [stPolling, setStPolling] = useState(false);
  const logRef = useRef(null);

  const token = localStorage.getItem('chess_token');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (user?.is_admin) fetchUsers();
    else setLoading(false);
  }, [user, fetchUsers]);

  // Poll stress test status
  useEffect(() => {
    if (!stPolling) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/stress-test/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setStStatus(data);
          if (!data.running) setStPolling(false);
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [stPolling, token]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [stStatus.log]);

  const showMsg = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const adminAction = async (url, method = 'PUT', body = undefined) => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const opts = { method, headers };
      if (body) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    } catch (err) {
      showMsg('error', err.message);
      return null;
    }
  };

  const handleBan = async (userId) => {
    const data = await adminAction(`${API_URL}/api/admin/users/${userId}/ban`);
    if (data) {
      showMsg('success', `${data.user.username} ${data.user.is_banned ? 'banned' : 'unbanned'}`);
      fetchUsers();
    }
  };

  const handleResetRating = async (userId) => {
    const data = await adminAction(`${API_URL}/api/admin/users/${userId}/reset-rating`);
    if (data) {
      showMsg('success', `${data.user.username} rating reset to 1200`);
      fetchUsers();
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    const data = await adminAction(`${API_URL}/api/admin/users/${userId}`, 'DELETE');
    if (data) {
      showMsg('success', 'User deleted');
      fetchUsers();
    }
  };

  const handleDeleteGame = async () => {
    const id = deleteGameId.trim();
    if (!id) return;
    const data = await adminAction(`${API_URL}/api/admin/games/${id}`, 'DELETE');
    if (data) {
      showMsg('success', `Game ${id} deleted`);
      setDeleteGameId('');
    }
  };

  const handleStartStress = async () => {
    const tc = TIME_CONTROLS[stConfig.timeControlIdx].value;
    const delayMs = DELAY_OPTIONS[stConfig.delayIdx].value;
    const body = {
      botCount: stConfig.botCount,
      timeControl: tc,
      movesBeforeEnd: stConfig.movesBeforeEnd,
      endMethod: stConfig.endMethod,
      rounds: stConfig.rounds,
      delayMs,
    };
    const data = await adminAction(`${API_URL}/api/admin/stress-test/start`, 'POST', body);
    if (data) {
      setStStatus(prev => ({ ...prev, running: true, log: [], gamesPlayed: 0, currentRound: 0 }));
      setStPolling(true);
      showMsg('success', 'Stress test started');
    }
  };

  const handleStopStress = async () => {
    const data = await adminAction(`${API_URL}/api/admin/stress-test/stop`, 'POST');
    if (data) {
      setStPolling(false);
      setStStatus({ running: false, log: stStatus.log, gamesPlayed: stStatus.gamesPlayed, currentRound: 0, totalRounds: 0 });
      showMsg('success', 'Stress test stopped');
    }
  };

  // Withdrawal approval handlers
  const fetchPendingWithdrawals = useCallback(async () => {
    setWdLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/withdrawals/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingWithdrawals(data.withdrawals);
      }
    } catch (err) {
      showMsg('error', err.message);
    } finally {
      setWdLoading(false);
    }
  }, [token]);

  const handleApproveWithdrawal = async (id) => {
    const data = await adminAction(`${API_URL}/api/admin/withdrawals/${id}/approve`, 'POST');
    if (data) {
      showMsg('success', 'Withdrawal approved');
      fetchPendingWithdrawals();
    }
  };

  const handleRejectWithdrawal = async (id) => {
    const reason = rejectReasons[id] || '';
    const data = await adminAction(`${API_URL}/api/admin/withdrawals/${id}/reject`, 'POST', { reason });
    if (data) {
      showMsg('success', 'Withdrawal rejected, tokens refunded');
      setRejectReasons((prev) => { const n = { ...prev }; delete n[id]; return n; });
      fetchPendingWithdrawals();
    }
  };

  // Transaction browser handlers
  const fetchTransactions = useCallback(async (page = 1, type = 'all') => {
    setTxLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/transactions?page=${page}&limit=50&type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions);
        setTxTotal(data.total);
        setTxPage(data.page);
      }
    } catch (err) {
      showMsg('error', err.message);
    } finally {
      setTxLoading(false);
    }
  }, [token]);

  const handleReverseTransaction = async (id) => {
    const reason = reverseReasons[id] || '';
    if (!reason.trim()) {
      showMsg('error', 'Please provide a reason for reversal');
      return;
    }
    const data = await adminAction(`${API_URL}/api/admin/transactions/${id}/reverse`, 'POST', { reason });
    if (data) {
      showMsg('success', 'Transaction reversed');
      setReverseReasons((prev) => { const n = { ...prev }; delete n[id]; return n; });
      fetchTransactions(txPage, txFilter);
    }
  };

  // Fetch data when switching tabs
  useEffect(() => {
    if (adminTab === 'withdrawals') fetchPendingWithdrawals();
    if (adminTab === 'transactions') fetchTransactions(1, txFilter);
  }, [adminTab, fetchPendingWithdrawals, fetchTransactions, txFilter]);

  if (!user?.is_admin) {
    return (
      <div className="admin-container">
        <h2>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)' }}>You do not have admin privileges.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-container" style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '40px auto' }} />
      </div>
    );
  }

  const selectStyle = {
    background: 'var(--surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    fontSize: '13px',
  };

  return (
    <div className="admin-container">
      <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '20px' }}>Admin Panel</h2>

      {/* Tab bar */}
      <div className="tab-bar" style={{ marginBottom: '20px' }}>
        {['users', 'withdrawals', 'transactions', 'stress'].map((t) => (
          <button key={t} className={adminTab === t ? 'active' : ''} onClick={() => setAdminTab(t)}>
            {t === 'users' ? 'Users' : t === 'withdrawals' ? 'Withdrawals' : t === 'transactions' ? 'Transactions' : 'Stress Test'}
          </button>
        ))}
      </div>

      {message && (
        <div
          style={{
            padding: '10px 16px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-sm)',
            background: message.type === 'error' ? 'rgba(229,57,53,0.12)' : 'rgba(124,179,66,0.12)',
            color: message.type === 'error' ? '#ef5350' : 'var(--accent-text)',
            fontSize: '13px',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Users tab */}
      {adminTab === 'users' && (
        <>
          {/* Delete game */}
          <div style={{ marginBottom: '24px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              className="input input-sm"
              placeholder="Game ID to delete"
              value={deleteGameId}
              onChange={(e) => setDeleteGameId(e.target.value)}
              style={{ maxWidth: '240px' }}
            />
            <button className="btn btn-danger btn-sm" onClick={handleDeleteGame}>
              Delete Game
            </button>
          </div>

          {/* Users table */}
          <div style={{ overflowX: 'auto', marginBottom: '32px' }}>
            <table className="leaderboard-table" style={{ minWidth: '600px' }}>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Rating</th>
                  <th>Games</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>
                      {u.username}
                      {u.is_admin && <span style={{ color: 'var(--accent)', marginLeft: '6px', fontSize: '12px' }}>ADMIN</span>}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{u.email}</td>
                    <td className="lb-rating">{u.rating}</td>
                    <td>{u.game_count}</td>
                    <td>
                      {u.is_banned ? (
                        <span style={{ color: '#ef5350', fontWeight: 600, fontSize: '12px' }}>BANNED</span>
                      ) : (
                        <span style={{ color: 'var(--accent-text)', fontSize: '12px' }}>Active</span>
                      )}
                    </td>
                    <td>
                      {u.id !== user.id && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <button
                            className={`btn btn-sm ${u.is_banned ? 'btn-primary' : 'btn-danger'}`}
                            onClick={() => handleBan(u.id)}
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            {u.is_banned ? 'Unban' : 'Ban'}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleResetRating(u.id)}
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            Reset Rating
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Withdrawals tab */}
      {adminTab === 'withdrawals' && (
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Pending Withdrawal Approvals</h3>
          {wdLoading ? (
            <div className="spinner" style={{ margin: '20px auto' }} />
          ) : pendingWithdrawals.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No pending withdrawals</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="leaderboard-table" style={{ minWidth: '700px' }}>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Asset</th>
                    <th>Address</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingWithdrawals.map((w) => (
                    <tr key={w.id}>
                      <td style={{ fontWeight: 600 }}>{w.username}</td>
                      <td>{parseFloat(w.amount_tokens).toFixed(2)} tokens</td>
                      <td>{w.asset} ({w.chain})</td>
                      <td style={{ fontSize: '11px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.to_address}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(w.created_at).toLocaleDateString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleApproveWithdrawal(w.id)} style={{ fontSize: '11px', padding: '4px 8px' }}>
                            Approve
                          </button>
                          <input
                            className="input input-sm"
                            placeholder="Reason"
                            value={rejectReasons[w.id] || ''}
                            onChange={(e) => setRejectReasons((prev) => ({ ...prev, [w.id]: e.target.value }))}
                            style={{ width: '100px', fontSize: '11px' }}
                          />
                          <button className="btn btn-danger btn-sm" onClick={() => handleRejectWithdrawal(w.id)} style={{ fontSize: '11px', padding: '4px 8px' }}>
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Transactions tab */}
      {adminTab === 'transactions' && (
        <div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Transaction Ledger</h3>
            <select
              className="input input-sm"
              value={txFilter}
              onChange={(e) => { setTxFilter(e.target.value); setTxPage(1); }}
              style={{ width: '160px' }}
            >
              <option value="all">All Types</option>
              <option value="deposit">Deposits</option>
              <option value="withdrawal">Withdrawals</option>
              <option value="wager_lock">Wager Locks</option>
              <option value="wager_win">Wager Wins</option>
              <option value="wager_refund">Wager Refunds</option>
              <option value="withdrawal_refund">Withdrawal Refunds</option>
              <option value="admin_reversal">Admin Reversals</option>
            </select>
          </div>
          {txLoading ? (
            <div className="spinner" style={{ margin: '20px auto' }} />
          ) : transactions.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No transactions found</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="leaderboard-table" style={{ minWidth: '700px' }}>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Balance After</th>
                      <th>Description</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td style={{ fontWeight: 600, fontSize: '13px' }}>{tx.username || 'N/A'}</td>
                        <td style={{ fontSize: '12px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: tx.type === 'deposit' ? 'rgba(124,179,66,0.15)' : tx.type.includes('reversal') ? 'rgba(229,57,53,0.15)' : 'rgba(124,58,237,0.15)',
                            color: tx.type === 'deposit' ? 'var(--accent-text)' : tx.type.includes('reversal') ? '#ef5350' : 'var(--accent)',
                            fontSize: '11px',
                          }}>
                            {tx.type}
                          </span>
                        </td>
                        <td style={{ color: parseFloat(tx.amount) >= 0 ? 'var(--accent-text)' : '#ef5350', fontWeight: 600 }}>
                          {parseFloat(tx.amount) >= 0 ? '+' : ''}{parseFloat(tx.amount).toFixed(2)}
                        </td>
                        <td style={{ fontSize: '13px' }}>{tx.balance_after != null ? parseFloat(tx.balance_after).toFixed(2) : '—'}</td>
                        <td style={{ fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</td>
                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(tx.created_at).toLocaleDateString()}</td>
                        <td>
                          {tx.type !== 'admin_reversal' && (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <input
                                className="input input-sm"
                                placeholder="Reason"
                                value={reverseReasons[tx.id] || ''}
                                onChange={(e) => setReverseReasons((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                                style={{ width: '80px', fontSize: '11px' }}
                              />
                              <button className="btn btn-danger btn-sm" onClick={() => handleReverseTransaction(tx.id)} style={{ fontSize: '11px', padding: '4px 6px' }}>
                                Reverse
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
                <button className="btn btn-ghost btn-sm" disabled={txPage <= 1} onClick={() => fetchTransactions(txPage - 1, txFilter)}>
                  Prev
                </button>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '32px' }}>
                  Page {txPage} of {Math.max(1, Math.ceil(txTotal / 50))}
                </span>
                <button className="btn btn-ghost btn-sm" disabled={txPage * 50 >= txTotal} onClick={() => fetchTransactions(txPage + 1, txFilter)}>
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Stress Test Section */}
      {adminTab === 'stress' && (
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>Stress Test</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Bots</label>
            <select
              value={stConfig.botCount}
              onChange={(e) => setStConfig(c => ({ ...c, botCount: Number(e.target.value) }))}
              disabled={stStatus.running}
              style={selectStyle}
            >
              {[2, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Time Control</label>
            <select
              value={stConfig.timeControlIdx}
              onChange={(e) => setStConfig(c => ({ ...c, timeControlIdx: Number(e.target.value) }))}
              disabled={stStatus.running}
              style={selectStyle}
            >
              {TIME_CONTROLS.map((tc, i) => <option key={i} value={i}>{tc.label}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Moves Before End</label>
            <input
              type="number"
              min={3}
              max={20}
              value={stConfig.movesBeforeEnd}
              onChange={(e) => setStConfig(c => ({ ...c, movesBeforeEnd: Math.max(3, Math.min(20, Number(e.target.value))) }))}
              disabled={stStatus.running}
              style={{ ...selectStyle, width: '70px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>End Method</label>
            <select
              value={stConfig.endMethod}
              onChange={(e) => setStConfig(c => ({ ...c, endMethod: e.target.value }))}
              disabled={stStatus.running}
              style={selectStyle}
            >
              <option value="mixed">Mixed</option>
              <option value="resign">Resign</option>
              <option value="draw">Draw</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Rounds</label>
            <input
              type="number"
              min={1}
              max={10}
              value={stConfig.rounds}
              onChange={(e) => setStConfig(c => ({ ...c, rounds: Math.max(1, Math.min(10, Number(e.target.value))) }))}
              disabled={stStatus.running}
              style={{ ...selectStyle, width: '70px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Move Delay</label>
            <select
              value={stConfig.delayIdx}
              onChange={(e) => setStConfig(c => ({ ...c, delayIdx: Number(e.target.value) }))}
              disabled={stStatus.running}
              style={selectStyle}
            >
              {DELAY_OPTIONS.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleStartStress}
            disabled={stStatus.running}
            style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 600 }}
          >
            Start Stress Test
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleStopStress}
            disabled={!stStatus.running}
            style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 600 }}
          >
            Stop Stress Test
          </button>
        </div>

        {/* Status */}
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>
            Status: <strong style={{ color: stStatus.running ? 'var(--accent-text)' : 'var(--text-primary)' }}>
              {stStatus.running ? 'Running' : 'Stopped'}
            </strong>
          </span>
          {stStatus.running && (
            <>
              <span>Round: {stStatus.currentRound}/{stStatus.totalRounds}</span>
              <span>Games played: {stStatus.gamesPlayed}</span>
              <span>Bots: {stStatus.botCount}</span>
            </>
          )}
        </div>

        {/* Log */}
        <div
          ref={logRef}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 12px',
            maxHeight: '240px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: '1.6',
          }}
        >
          {stStatus.log?.length > 0 ? (
            stStatus.log.map((line, i) => <div key={i}>{line}</div>)
          ) : (
            <span style={{ fontStyle: 'italic' }}>No activity yet</span>
          )}
        </div>
      </div>
      )}
    </div>
  );
};

export default AdminPage;
