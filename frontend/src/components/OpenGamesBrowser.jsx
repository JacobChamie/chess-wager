import { useState, useEffect, memo, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket, sessionId } from '../socket.js';
import { useAuth } from '../context/AuthContext.jsx';

const formatTc = (tc) => {
  if (!tc) return '?';
  if (typeof tc === 'object') {
    const mins = Math.round(tc.time / 60);
    return tc.increment > 0 ? `${mins}+${tc.increment}` : `${mins} min`;
  }
  return `${Math.round(tc / 60)} min`;
};

const colorPrefIcon = (pref) => {
  if (pref === 'white') return '\u2654';
  if (pref === 'black') return '\u265A';
  return '\uD83C\uDFB2';
};

const OpenGamesBrowser = memo(({ onEditGame, onCancelSeeking, onEditSeeking }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [openGames, setOpenGames] = useState([]);
  const [seekers, setSeekers] = useState([]);
  const [activeGames, setActiveGames] = useState([]);

  useEffect(() => {
    socket.emit('lobby:get_state');

    const onStateUpdate = ({ openGames: games, seekers: s, activeGames: ag }) => {
      setOpenGames(games || []);
      setSeekers(s || []);
      setActiveGames(ag || []);
    };

    socket.on('lobby:state_update', onStateUpdate);
    return () => {
      socket.off('lobby:state_update', onStateUpdate);
    };
  }, []);

  const handleJoin = (gameId) => {
    const playerName = user?.username || localStorage.getItem('chess_player_name') || 'Anonymous';
    socket.emit('lobby:join_game', { gameId, playerName });
  };

  const handleDelete = () => {
    socket.emit('lobby:cancel_game', {});
    onCancelSeeking?.();
  };

  const handleEdit = () => {
    socket.emit('lobby:cancel_game', {});
    onEditGame?.();
  };

  const handleCancelSeeking = () => {
    socket.emit('lobby:cancel_play', {});
    onCancelSeeking?.();
  };

  const handleEditSeeking = (seeker) => {
    socket.emit('lobby:cancel_play', {});
    onEditSeeking?.(seeker.timeControl);
  };

  const handleMatchSeeker = (seeker) => {
    const playerName = user?.username || localStorage.getItem('chess_player_name') || 'Anonymous';
    socket.emit('lobby:play', {
      timeControl: seeker.timeControl,
      playerName,
      wagerAmount: seeker.wagerAmount || 0,
      colorPref: undefined,
      rating: user?.rating || null,
    });
  };

  const hasContent = openGames.length > 0 || seekers.length > 0 || activeGames.length > 0;

  const sortedOpenGames = useMemo(
    () => [...openGames].sort((a, b) => (b.isPremium ? 1 : 0) - (a.isPremium ? 1 : 0) || (b.wagerAmount || 0) - (a.wagerAmount || 0)),
    [openGames]
  );
  const sortedSeekers = useMemo(
    () => [...seekers].sort((a, b) => (b.isPremium ? 1 : 0) - (a.isPremium ? 1 : 0) || (b.wagerAmount || 0) - (a.wagerAmount || 0)),
    [seekers]
  );
  const sortedActiveGames = useMemo(
    () => [...activeGames].sort((a, b) => ((b.whiteIsPremium || b.blackIsPremium) ? 1 : 0) - ((a.whiteIsPremium || a.blackIsPremium) ? 1 : 0) || (b.wagerAmount || 0) - (a.wagerAmount || 0)),
    [activeGames]
  );

  return (
    <div>
      {!hasContent && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--text-secondary)',
          fontSize: '15px',
        }}>
          No open games right now
        </div>
      )}

      {openGames.length > 0 && (
        <div className="open-games-list">
          {sortedOpenGames.map((game) => {
            const isMine = game.creatorSessionId === sessionId;
            return (
              <div
                key={game.gameId}
                className={`open-game-row${isMine ? '' : ' open-game-row--joinable'}`}
                onClick={isMine ? undefined : () => handleJoin(game.gameId)}
              >
                <div className="open-game-info">
                  <span className="open-game-name">
                    <span style={game.isPremium ? { color: '#ffd700', textShadow: '0 0 6px rgba(255,215,0,0.4)', fontWeight: 700 } : undefined}>
                      {game.isPremium && '\u2605 '}{game.creatorName}
                    </span>
                    {game.isPremium && <span className="premium-badge">PREMIUM</span>}
                    {game.rating && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '4px' }}>({game.rating})</span>}
                    {isMine && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '6px' }}>(you)</span>}
                  </span>
                  <span className="open-game-tc">
                    {colorPrefIcon(game.colorPref)} {formatTc(game.timeControl)}
                    {game.wagerAmount > 0 && <span style={{ color: '#ffd700', marginLeft: '6px', fontWeight: 600 }}>{game.wagerAmount} tok</span>}
                  </span>
                </div>
                {isMine ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="navbar-icon-btn"
                      onClick={(e) => { e.stopPropagation(); handleEdit(); }}
                      title="Edit time control"
                      style={{ width: '32px', height: '32px', fontSize: '14px' }}
                    >
                      {'\u270F\uFE0F'}
                    </button>
                    <button
                      className="navbar-icon-btn"
                      onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                      title="Delete game"
                      style={{ width: '32px', height: '32px', fontSize: '14px', borderColor: 'rgba(229,57,53,0.3)' }}
                    >
                      {'\uD83D\uDDD1\uFE0F'}
                    </button>
                  </div>
                ) : (
                  <span className="btn btn-primary btn-sm">Join</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {seekers.length > 0 && (
        <div style={{ marginTop: openGames.length > 0 ? '16px' : '0' }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            marginBottom: '8px',
          }}>
            Players Seeking
          </div>
          <div className="open-games-list">
            {sortedSeekers.map((seeker, i) => {
              const isMine = seeker.sessionId === sessionId;
              return (
                <div
                  key={i}
                  className={`open-game-row${isMine ? '' : ' open-game-row--joinable'}`}
                  onClick={isMine ? undefined : () => handleMatchSeeker(seeker)}
                >
                  <div className="open-game-info">
                    <span className="open-game-name">
                      <span style={seeker.isPremium ? { color: '#ffd700', textShadow: '0 0 6px rgba(255,215,0,0.4)', fontWeight: 700 } : undefined}>
                        {seeker.isPremium && '\u2605 '}{seeker.playerName}
                      </span>
                      {seeker.isPremium && <span className="premium-badge">PREMIUM</span>}
                      {seeker.rating && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '4px' }}>({seeker.rating})</span>}
                      {isMine && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '6px' }}>(you)</span>}
                    </span>
                    <span className="open-game-tc">
                      {colorPrefIcon(seeker.colorPref)} {formatTc(seeker.timeControl)}
                      {seeker.wagerAmount > 0 && <span style={{ color: '#ffd700', marginLeft: '6px', fontWeight: 600 }}>{seeker.wagerAmount} tok</span>}
                    </span>
                  </div>
                  {isMine ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="navbar-icon-btn"
                        onClick={(e) => { e.stopPropagation(); handleEditSeeking(seeker); }}
                        title="Edit time control"
                        style={{ width: '32px', height: '32px', fontSize: '14px' }}
                      >
                        {'\u270F\uFE0F'}
                      </button>
                      <button
                        className="navbar-icon-btn"
                        onClick={(e) => { e.stopPropagation(); handleCancelSeeking(); }}
                        title="Cancel seeking"
                        style={{ width: '32px', height: '32px', fontSize: '14px', borderColor: 'rgba(229,57,53,0.3)' }}
                      >
                        {'\uD83D\uDDD1\uFE0F'}
                      </button>
                    </div>
                  ) : (
                    <span className="btn btn-primary btn-sm">Play</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeGames.length > 0 && (
        <div style={{ marginTop: (openGames.length > 0 || seekers.length > 0) ? '16px' : '0' }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span className="live-badge" />
            Live Games
          </div>
          <div className="open-games-list">
            {sortedActiveGames.map((game) => (
              <div
                key={game.gameId}
                className="open-game-row open-game-row--joinable"
                onClick={() => navigate(`/game/${game.gameId}`)}
              >
                <div className="open-game-info">
                  <span className="open-game-name">
                    <span style={game.whiteIsPremium ? { color: '#ffd700', fontWeight: 700 } : undefined}>
                      {game.whiteIsPremium && '\u2605 '}{game.whiteName}
                    </span>
                    {' vs '}
                    <span style={game.blackIsPremium ? { color: '#ffd700', fontWeight: 700 } : undefined}>
                      {game.blackIsPremium && '\u2605 '}{game.blackName}
                    </span>
                    {(game.whiteIsPremium || game.blackIsPremium) && <span className="premium-badge">PREMIUM</span>}
                    {game.isBotGame && (
                      <span style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(255,152,0,0.15)',
                        color: '#ffa726',
                        marginLeft: '6px',
                        fontWeight: 600,
                      }}>
                        BOT
                      </span>
                    )}
                    {game.wagerAmount > 0 && (
                      <span style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(255,215,0,0.15)',
                        color: '#ffd700',
                        marginLeft: '6px',
                        fontWeight: 600,
                      }}>
                        {game.wagerAmount} tok
                      </span>
                    )}
                  </span>
                  <span className="open-game-tc">{formatTc(game.timeControl)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="spectator-badge">
                    {'\uD83D\uDC41'} {game.spectatorCount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

OpenGamesBrowser.displayName = 'OpenGamesBrowser';

export default OpenGamesBrowser;
