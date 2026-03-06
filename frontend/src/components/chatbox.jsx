import { useState, useRef, useEffect, memo, useCallback } from 'react';

const EMOJI_GRID = [
  '\uD83D\uDE00', '\uD83D\uDE02', '\uD83E\uDD23', '\uD83D\uDE0E', '\uD83E\uDD14', '\uD83D\uDE0F',
  '\uD83D\uDD25', '\uD83D\uDCAA', '\uD83D\uDC4F', '\uD83C\uDF89', '\uD83D\uDC40', '\uD83D\uDC80',
  '\u265F\uFE0F', '\uD83D\uDC51', '\u26A1', '\uD83C\uDFC6', '\uD83D\uDE24', '\uD83E\uDD1D',
  '\u2764\uFE0F', '\uD83D\uDC94', '\uD83D\uDE05', '\uD83E\uDEE1', '\uD83D\uDE08', '\uD83E\uDD72',
];

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

const REASON_LABELS = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold_repetition: 'Threefold Repetition',
  insufficient_material: 'Insufficient Material',
  draw: 'Draw',
  draw_agreement: 'Draw by Agreement',
  timeout: 'Time Ran Out',
  resign: 'Resignation',
  abandonment: 'Abandonment',
  game_over: 'Game Over',
};

const getMoveText = (move) => {
  if (!move) return '';
  if (typeof move === 'string') return move;
  return move.san || '';
};

const ChatBox = memo(({
  messages = [], onSend, moves = [], myName = '',
  isSpectator = false, spectatorMessages = [], onSpectatorSend,
  gameStatus = 'active', gameResult = null, gameReason = null,
  onMoveClick, viewMoveIndex,
}) => {
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState(isSpectator ? 'spectators' : 'chat');
  const [showEmojis, setShowEmojis] = useState(false);
  const chatEndRef = useRef(null);
  const spectatorEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'chat' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    if (activeTab === 'spectators' && spectatorEndRef.current) {
      spectatorEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, spectatorMessages, activeTab]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (activeTab === 'spectators' && onSpectatorSend) {
      onSpectatorSend(trimmed);
    } else if (activeTab === 'chat' && onSend) {
      onSend(trimmed);
    }
    setInput('');
    setShowEmojis(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const insertEmoji = (emoji) => {
    setInput((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const getNameColor = useCallback((senderName) => {
    if (senderName === myName) return 'var(--accent)';
    return '#64b5f6';
  }, [myName]);

  return (
    <div className="chatbox">
      {/* Tabs */}
      <div className="chatbox-tabs">
        {(isSpectator
          ? ['spectators', 'moves']
          : gameStatus === 'completed'
            ? ['chat', 'spectators', 'moves']
            : ['chat', 'moves']
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`chatbox-tab${activeTab === tab ? ' chatbox-tab--active' : ''}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'chat' && !isSpectator && (
        <>
          {/* Messages area */}
          <div className="chatbox-messages">
            {messages.length === 0 && (
              <div className="chatbox-empty">
                No messages yet
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className="chatbox-msg">
                <div className="chatbox-msg-header">
                  <span
                    className="chatbox-msg-name"
                    style={{ color: getNameColor(msg.senderName) }}
                  >
                    {msg.senderName}
                  </span>
                  <span className="chatbox-msg-time">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div className="chatbox-msg-body">
                  {msg.message}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Emoji picker */}
          {showEmojis && (
            <div className="chatbox-emoji-grid">
              {EMOJI_GRID.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  className="chatbox-emoji-btn"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="chatbox-input-row">
            <input
              ref={inputRef}
              className="input input-sm"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message"
              style={{ flex: 1 }}
            />
            <button
              onClick={() => setShowEmojis((v) => !v)}
              title="Emojis"
              className="btn btn-sm"
              style={{
                padding: '6px 8px',
                background: showEmojis ? 'var(--accent)' : 'var(--bg-elevated)',
                border: `1px solid ${showEmojis ? 'var(--accent)' : 'var(--border)'}`,
                fontSize: '18px',
                lineHeight: 1,
              }}
            >
              {'\uD83D\uDE00'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSend}
            >
              Send
            </button>
          </div>
        </>
      )}

      {activeTab === 'spectators' && (
        <>
          <div className={`chatbox-messages${isSpectator ? '' : ' chatbox-messages--no-margin'}`}>
            {spectatorMessages.length === 0 && (
              <div className="chatbox-empty">
                No spectator messages yet
              </div>
            )}
            {spectatorMessages.map((msg, idx) => (
              <div key={idx} className="chatbox-msg">
                <div className="chatbox-msg-header">
                  <span className="chatbox-msg-name" style={{ color: '#ab47bc' }}>
                    {msg.senderName}
                  </span>
                  <span className="chatbox-msg-time">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div className="chatbox-msg-body">
                  {msg.message}
                </div>
              </div>
            ))}
            <div ref={spectatorEndRef} />
          </div>

          {isSpectator && (
            <div className="chatbox-input-row">
              <input
                ref={inputRef}
                className="input input-sm"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Spectator chat"
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSend}>
                Send
              </button>
            </div>
          )}
        </>
      )}

      {activeTab === 'moves' && (
        <div className="chatbox-messages">
          {moves.length === 0 ? (
            <div className="chatbox-empty">
              No moves yet
            </div>
          ) : (
            <table className="chatbox-move-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>White</th>
                  <th>Black</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((row) => {
                  const whiteIdx = (row.moveNumber - 1) * 2;
                  const blackIdx = whiteIdx + 1;
                  const whiteText = getMoveText(row.white);
                  const blackText = getMoveText(row.black);
                  return (
                    <tr key={row.moveNumber}>
                      <td className="chatbox-move-num">
                        {row.moveNumber}.
                      </td>
                      <td
                        className={`chatbox-move-cell${viewMoveIndex === whiteIdx ? ' chatbox-move-cell--active' : ''}${whiteText && onMoveClick ? ' chatbox-move-cell--clickable' : ''}`}
                        onClick={() => whiteText && onMoveClick?.(whiteIdx)}
                      >
                        {whiteText}
                      </td>
                      <td
                        className={`chatbox-move-cell${viewMoveIndex === blackIdx ? ' chatbox-move-cell--active' : ''}${blackText && onMoveClick ? ' chatbox-move-cell--clickable' : ''}`}
                        onClick={() => blackText && onMoveClick?.(blackIdx)}
                      >
                        {blackText}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {gameStatus === 'completed' && gameResult && (
            <div className="chatbox-game-result">
              <span style={{ color: 'var(--text-primary)' }}>{gameResult}</span>
              {gameReason && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' \u2014 '}{REASON_LABELS[gameReason] || gameReason.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ChatBox.displayName = 'ChatBox';

export default ChatBox;
