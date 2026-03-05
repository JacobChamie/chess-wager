import { useState, useEffect } from 'react';
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

const OpenGamesBrowser = ({ onEditGame }) => {
  const { user } = useAuth();
  const [openGames, setOpenGames] = useState([]);
  const [seekers, setSeekers] = useState([]);

  useEffect(() => {
    socket.emit('lobby:get_state');

    const onStateUpdate = ({ openGames: games, seekers: s }) => {
      setOpenGames(games || []);
      setSeekers(s || []);
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
  };

  const handleEdit = () => {
    socket.emit('lobby:cancel_game', {});
    onEditGame?.();
  };

  const hasContent = openGames.length > 0 || seekers.length > 0;

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
          {openGames.map((game) => {
            const isMine = game.creatorSessionId === sessionId;
            return (
              <div
                key={game.gameId}
                className={`open-game-row${isMine ? '' : ' open-game-row--joinable'}`}
                onClick={isMine ? undefined : () => handleJoin(game.gameId)}
              >
                <div className="open-game-info">
                  <span className="open-game-name">
                    {game.creatorName}
                    {isMine && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '6px' }}>(you)</span>}
                  </span>
                  <span className="open-game-tc">{formatTc(game.timeControl)}</span>
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
            {seekers.map((seeker, i) => (
              <div key={i} className="open-game-row">
                <div className="open-game-info">
                  <span className="open-game-name">{seeker.playerName}</span>
                  <span className="open-game-tc">{formatTc(seeker.timeControl)}</span>
                </div>
                <span className="seeking-badge">Seeking</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default OpenGamesBrowser;
