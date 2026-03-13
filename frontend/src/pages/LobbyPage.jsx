import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket.js';
import { useAuth } from '../context/AuthContext.jsx';
import OpenGamesBrowser from '../components/OpenGamesBrowser.jsx';
import BotCard from '../components/BotCard.jsx';
import WagerSelector from '../components/WagerSelector.jsx';
import WagerGateSelector from '../components/WagerGateSelector.jsx';

const DEFAULT_BOT_PERSONALITIES = [
  { id: 'beginner', name: 'Woody', title: 'The Beginner', description: 'Just learning the pieces', rating: 800 },
  { id: 'easy', name: 'Chip', title: 'The Casual', description: 'Knows the basics, makes mistakes', rating: 1100 },
  { id: 'medium', name: 'Sierra', title: 'The Club Player', description: 'Solid fundamentals, tactical awareness', rating: 1400 },
  { id: 'hard', name: 'Magnus Jr.', title: 'The Competitor', description: 'Strong positional play, few blunders', rating: 1800 },
  { id: 'expert', name: 'Athena', title: 'The Expert', description: 'Near-master level, very dangerous', rating: 2200 },
  { id: 'master', name: 'Deep Mind', title: 'The Grandmaster', description: 'Maximum strength, no mercy', rating: 3000 },
];

const TIME_PRESETS = [
  { label: '1+0', time: 60, increment: 0, category: 'Bullet' },
  { label: '1+1', time: 60, increment: 1, category: 'Bullet' },
  { label: '2+1', time: 120, increment: 1, category: 'Bullet' },
  { label: '3+0', time: 180, increment: 0, category: 'Blitz' },
  { label: '3+2', time: 180, increment: 2, category: 'Blitz' },
  { label: '5+0', time: 300, increment: 0, category: 'Blitz' },
  { label: '5+3', time: 300, increment: 3, category: 'Blitz' },
  { label: '10+0', time: 600, increment: 0, category: 'Rapid' },
  { label: '10+5', time: 600, increment: 5, category: 'Rapid' },
  { label: '15+10', time: 900, increment: 10, category: 'Rapid' },
  { label: '30+0', time: 1800, increment: 0, category: 'Classical' },
];

const CAT_COLORS = {
  Bullet: 'var(--cat-bullet)',
  Blitz: 'var(--cat-blitz)',
  Rapid: 'var(--cat-rapid)',
  Classical: 'var(--cat-classical)',
};

const CAT_ICONS = {
  Bullet: '\u26A1',
  Blitz: '\uD83D\uDD25',
  Rapid: '\u23F1\uFE0F',
  Classical: '\uD83C\uDFDB\uFE0F',
};

const tcKey = (tc) => `${tc.time}+${tc.increment}`;

const LobbyPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tab, setTab] = useState('quick');
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('chess_player_name') || ''
  );
  const [timeControl, setTimeControl] = useState({ time: 300, increment: 0 });
  const [colorPref, setColorPref] = useState('random');
  const [showCustom, setShowCustom] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('5');
  const [customIncrement, setCustomIncrement] = useState('0');
  const [status, setStatus] = useState('idle');
  const [pendingGameId, setPendingGameId] = useState(null);
  const [joinGameId, setJoinGameId] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [botPersonalities, setBotPersonalities] = useState(DEFAULT_BOT_PERSONALITIES);
  const [botPrivate, setBotPrivate] = useState(false);
  const [wagerAmount, setWagerAmount] = useState(0);
  const [wagerGates, setWagerGates] = useState({});

  const getName = useCallback(
    () => user?.username || playerName.trim() || 'Anonymous',
    [user, playerName]
  );

  useEffect(() => {
    socket.connect();

    const onQueued = () => setStatus('queued');
    const onGameCreated = ({ gameId }) => {
      setPendingGameId(gameId);
      setStatus('waiting');
    };
    const onGameStart = ({ gameId }) => navigate(`/game/${gameId}`);
    const onError = ({ message }) => {
      setError(message);
      setStatus('idle');
    };
    const onBotGameStart = ({ gameId }) => navigate(`/game/${gameId}`);
    const onBotPersonalities = (personalities) => setBotPersonalities(personalities);
    const onBotError = ({ message }) => {
      setError(message);
      setStatus('idle');
    };

    socket.on('lobby:queued', onQueued);
    socket.on('lobby:game_created', onGameCreated);
    socket.on('lobby:game_start', onGameStart);
    socket.on('lobby:error', onError);
    socket.on('bot:game_start', onBotGameStart);
    socket.on('bot:personalities', onBotPersonalities);
    socket.on('bot:error', onBotError);

    // Request bot personalities
    socket.emit('bot:get_personalities');

    return () => {
      socket.off('lobby:queued', onQueued);
      socket.off('lobby:game_created', onGameCreated);
      socket.off('lobby:game_start', onGameStart);
      socket.off('lobby:error', onError);
      socket.off('bot:game_start', onBotGameStart);
      socket.off('bot:personalities', onBotPersonalities);
      socket.off('bot:error', onBotError);
    };
  }, [navigate]);

  const handleSelectPreset = (preset) => {
    setTimeControl({ time: preset.time, increment: preset.increment });
    setShowCustom(false);
  };

  const handleApplyCustom = () => {
    const mins = Math.max(0.25, Math.min(180, parseFloat(customMinutes) || 5));
    const inc = Math.max(0, Math.min(300, parseInt(customIncrement) || 0));
    setTimeControl({ time: Math.round(mins * 60), increment: inc });
    setShowCustom(false);
  };

  const handlePlay = () => {
    setError(null);
    const name = getName();
    if (!user) localStorage.setItem('chess_player_name', name);
    const gates = wagerAmount > 0 && Object.keys(wagerGates).length > 0 ? wagerGates : undefined;
    socket.emit('lobby:play', { timeControl, playerName: name, colorPref, rating: user?.rating || null, wagerAmount, gates });
    setStatus('queued');
  };

  const handleCancelPlay = () => {
    socket.emit('lobby:cancel_play', {});
    setStatus('idle');
  };

  const handleCreateGame = () => {
    setError(null);
    const name = getName();
    if (!user) localStorage.setItem('chess_player_name', name);
    const gates = wagerAmount > 0 && Object.keys(wagerGates).length > 0 ? wagerGates : undefined;
    socket.emit('lobby:create_game', { timeControl, playerName: name, colorPref, rating: user?.rating || null, wagerAmount, gates });
    setStatus('creating');
  };

  const handleCancelGame = () => {
    socket.emit('lobby:cancel_game', {});
    setPendingGameId(null);
    setStatus('idle');
  };

  const handleJoinGame = () => {
    if (!joinGameId.trim()) return;
    setError(null);
    const name = getName();
    if (!user) localStorage.setItem('chess_player_name', name);
    let id = joinGameId.trim();
    const match = id.match(/\/game\/([^/]+)/);
    if (match) id = match[1];
    socket.emit('lobby:join_game', { gameId: id, playerName: name });
  };

  const copyGameLink = () => {
    const link = `${window.location.origin}/game/${pendingGameId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handlePlayBot = () => {
    if (!selectedBot) return;
    setError(null);
    const name = getName();
    if (!user) localStorage.setItem('chess_player_name', name);
    socket.emit('bot:start_game', {
      personalityId: selectedBot.id,
      timeControl,
      playerName: name,
      colorPref,
      isPrivate: botPrivate,
    });
  };

  const selectedKey = tcKey(timeControl);
  const tcDisplay = timeControl.increment > 0
    ? `${Math.round(timeControl.time / 60)}+${timeControl.increment}`
    : `${Math.round(timeControl.time / 60)} min`;

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 52px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px',
      }}
    >
      {/* Main card */}
      <div
        className="card"
        style={{ width: '100%', maxWidth: '480px', padding: '0', margin: 'auto 0' }}
      >
        {/* Tab bar */}
        <div className="tab-bar">
          <button className={tab === 'quick' ? 'active' : ''} onClick={() => setTab('quick')}>
            Quick Play
          </button>
          <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
            Open Games
          </button>
          <button className={tab === 'bot' ? 'active' : ''} onClick={() => setTab('bot')}>
            vs Bot
          </button>
        </div>

        <div style={{ padding: '0 28px 28px' }}>
          {tab === 'quick' && (
            <>
              {/* Name input — only show for guests */}
              {!user && (
                <div style={{ marginBottom: '24px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                      marginBottom: '8px',
                    }}
                  >
                    Display Name
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Enter your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                  />
                </div>
              )}

              {/* Time control grid */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    marginBottom: '12px',
                  }}
                >
                  Time Control
                </label>

                <div className="tc-grid">
                  {TIME_PRESETS.map((p) => {
                    const key = tcKey(p);
                    const isSelected = selectedKey === key && !showCustom;
                    return (
                      <div
                        key={key}
                        className={`tc-tile${isSelected ? ' selected' : ''}`}
                        onClick={() => handleSelectPreset(p)}
                      >
                        <span className="tc-label">{p.label}</span>
                        <span
                          className="tc-category"
                          style={{ color: CAT_COLORS[p.category] }}
                        >
                          {CAT_ICONS[p.category]} {p.category}
                        </span>
                      </div>
                    );
                  })}

                  {/* Custom tile */}
                  <div
                    className={`tc-tile${showCustom ? ' selected' : ''}`}
                    onClick={() => setShowCustom((v) => !v)}
                  >
                    <span className="tc-label" style={{ fontSize: '16px' }}>
                      {'\u2699\uFE0F'}
                    </span>
                    <span
                      className="tc-category"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Custom
                    </span>
                  </div>
                </div>

                {/* Custom inputs */}
                {showCustom && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '16px',
                      background: 'var(--bg-base)',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <label
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        Minutes
                      </label>
                      <input
                        className="input input-sm"
                        type="number"
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        min="0.25"
                        max="180"
                        step="0.5"
                      />
                    </div>
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '20px',
                        paddingTop: '16px',
                      }}
                    >
                      +
                    </span>
                    <div style={{ flex: 1 }}>
                      <label
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        Increment (sec)
                      </label>
                      <input
                        className="input input-sm"
                        type="number"
                        value={customIncrement}
                        onChange={(e) => setCustomIncrement(e.target.value)}
                        min="0"
                        max="300"
                        step="1"
                      />
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleApplyCustom}
                      style={{ marginTop: '16px' }}
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>

              {/* Color preference */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    marginBottom: '8px',
                  }}
                >
                  Play As
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { value: 'white', label: '\u2654 White' },
                    { value: 'random', label: '\uD83C\uDFB2 Random' },
                    { value: 'black', label: '\u265A Black' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`btn btn-sm${colorPref === opt.value ? ' btn-primary' : ' btn-ghost'}`}
                      onClick={() => setColorPref(opt.value)}
                      style={{ flex: 1 }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Wager selector */}
              <WagerSelector value={wagerAmount} onChange={setWagerAmount} />

              {/* Wager gates */}
              <WagerGateSelector gates={wagerGates} onChange={setWagerGates} visible={wagerAmount > 0} />

              {/* Error */}
              {error && (
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '10px 16px',
                    background: 'rgba(229, 57, 53, 0.12)',
                    border: '1px solid rgba(229, 57, 53, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#ef5350',
                    fontSize: '14px',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Actions */}
              {status === 'idle' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={handlePlay}
                    style={{ width: '100%' }}
                  >
                    {wagerAmount > 0 ? `Play ${tcDisplay} \u2014 ${wagerAmount} Token Wager` : `Play ${tcDisplay}`}
                  </button>

                  <button
                    className="btn btn-ghost"
                    onClick={handleCreateGame}
                    style={{ width: '100%' }}
                  >
                    Create Private Game
                  </button>

                  <div className="divider" />

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      className="input"
                      type="text"
                      placeholder="Game ID or link"
                      value={joinGameId}
                      onChange={(e) => setJoinGameId(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-primary" onClick={handleJoinGame}>
                      Join
                    </button>
                  </div>
                </div>
              )}

              {status === 'queued' && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div
                    className="spinner"
                    style={{ margin: '0 auto 16px auto' }}
                  />
                  <p
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    Finding an opponent...
                  </p>
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '20px',
                    }}
                  >
                    {tcDisplay}
                  </p>
                  <button className="btn btn-danger" onClick={handleCancelPlay}>
                    Cancel
                  </button>
                </div>
              )}

              {status === 'waiting' && pendingGameId && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div
                    className="spinner"
                    style={{ margin: '0 auto 16px auto' }}
                  />
                  <p
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    Waiting for opponent...
                  </p>
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '16px',
                    }}
                  >
                    {tcDisplay}
                  </p>
                  <div
                    style={{
                      background: 'var(--bg-base)',
                      border: '1px solid var(--border)',
                      padding: '12px 16px',
                      borderRadius: 'var(--radius)',
                      marginBottom: '12px',
                      fontSize: '13px',
                      wordBreak: 'break-all',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {window.location.origin}/game/{pendingGameId}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    <button
                      className="btn btn-primary"
                      onClick={copyGameLink}
                    >
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={handleCancelGame}
                      title="Edit time control"
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={handleCancelGame}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {status === 'creating' && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div className="spinner" style={{ margin: '0 auto 16px auto' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600 }}>
                    Creating game...
                  </p>
                </div>
              )}
            </>
          )}

          {tab === 'open' && (
            <OpenGamesBrowser
              onEditGame={() => {
                setPendingGameId(null);
                setStatus('idle');
                setTab('quick');
              }}
              onCancelSeeking={() => {
                setStatus('idle');
              }}
              onEditSeeking={(tc) => {
                setStatus('idle');
                if (tc && typeof tc === 'object') {
                  setTimeControl({ time: tc.time, increment: tc.increment || 0 });
                }
                setTab('quick');
              }}
            />
          )}

          {tab === 'bot' && (
            <>
              {/* Bot selection */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    marginBottom: '12px',
                  }}
                >
                  Choose Opponent
                </label>
                <div className="tc-grid bot-grid">
                  {botPersonalities.map((bot) => (
                    <BotCard
                      key={bot.id}
                      bot={bot}
                      selected={selectedBot?.id === bot.id}
                      onClick={() => setSelectedBot(bot)}
                    />
                  ))}
                </div>
              </div>

              {/* Time control grid (reused from quick play) */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    marginBottom: '12px',
                  }}
                >
                  Time Control
                </label>
                <div className="tc-grid">
                  {TIME_PRESETS.map((p) => {
                    const key = tcKey(p);
                    const isSelected = selectedKey === key;
                    return (
                      <div
                        key={key}
                        className={`tc-tile${isSelected ? ' selected' : ''}`}
                        onClick={() => handleSelectPreset(p)}
                      >
                        <span className="tc-label">{p.label}</span>
                        <span
                          className="tc-category"
                          style={{ color: CAT_COLORS[p.category] }}
                        >
                          {CAT_ICONS[p.category]} {p.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Color preference */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    marginBottom: '8px',
                  }}
                >
                  Play As
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { value: 'white', label: '\u2654 White' },
                    { value: 'random', label: '\uD83C\uDFB2 Random' },
                    { value: 'black', label: '\u265A Black' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`btn btn-sm${colorPref === opt.value ? ' btn-primary' : ' btn-ghost'}`}
                      onClick={() => setColorPref(opt.value)}
                      style={{ flex: 1 }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Private game toggle */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={botPrivate}
                    onChange={(e) => setBotPrivate(e.target.checked)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  Private game (hidden from spectators)
                </label>
              </div>

              {/* Error */}
              {error && (
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '10px 16px',
                    background: 'rgba(229, 57, 53, 0.12)',
                    border: '1px solid rgba(229, 57, 53, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#ef5350',
                    fontSize: '14px',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Play button */}
              <button
                className="btn btn-primary btn-lg"
                onClick={handlePlayBot}
                disabled={!selectedBot}
                style={{ width: '100%' }}
              >
                {selectedBot ? `Play vs ${selectedBot.name}` : 'Select a Bot'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <p
        style={{
          marginTop: '32px',
          fontSize: '12px',
          color: 'var(--text-muted)',
        }}
      >
        ELO Stakes v1.0
      </p>
    </div>
  );
};

export default LobbyPage;
