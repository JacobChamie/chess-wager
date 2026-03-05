import { useState, useRef, useEffect } from 'react';

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

const ChatBox = ({ messages = [], onSend, moves = [], myName = '' }) => {
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const [showEmojis, setShowEmojis] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'chat' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !onSend) return;
    onSend(trimmed);
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

  const getNameColor = (senderName) => {
    if (senderName === myName) return 'var(--accent)';
    return '#64b5f6';
  };

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        width: '100%',
        color: 'var(--text-primary)',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          marginBottom: '12px',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        {['chat', 'moves'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 0',
              border: 'none',
              background: activeTab === tab ? 'var(--bg-elevated)' : 'var(--bg-base)',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              transition: 'all var(--transition)',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'chat' ? (
        <>
          {/* Messages area */}
          <div
            style={{
              flex: 1,
              minHeight: '120px',
              overflowY: 'auto',
              marginBottom: '12px',
              background: 'var(--bg-base)',
              padding: '10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                No messages yet
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{ marginBottom: '8px', textAlign: 'left' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                  <span
                    style={{
                      color: getNameColor(msg.senderName),
                      fontWeight: 600,
                      fontSize: '13px',
                    }}
                  >
                    {msg.senderName}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    marginTop: '2px',
                    color: 'var(--text-primary)',
                    wordBreak: 'break-word',
                    lineHeight: 1.4,
                  }}
                >
                  {msg.message}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Emoji picker */}
          {showEmojis && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: '2px',
                marginBottom: '8px',
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius)',
                padding: '8px',
                border: '1px solid var(--border)',
              }}
            >
              {EMOJI_GRID.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  style={{
                    border: 'none',
                    background: 'none',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '6px',
                    lineHeight: 1,
                    transition: 'background var(--transition)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: '120px',
            overflowY: 'auto',
            background: 'var(--bg-base)',
            padding: '10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}
        >
          {moves.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
              No moves yet
            </div>
          ) : (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingBottom: '8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600 }}>#</th>
                  <th style={{ textAlign: 'left', paddingBottom: '8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600 }}>White</th>
                  <th style={{ textAlign: 'left', paddingBottom: '8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600 }}>Black</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((row) => (
                  <tr key={row.moveNumber}>
                    <td style={{ padding: '4px 4px 4px 0', color: 'var(--text-muted)', width: '10%' }}>
                      {row.moveNumber}.
                    </td>
                    <td style={{ padding: '4px', width: '45%' }}>{row.white}</td>
                    <td style={{ padding: '4px', width: '45%' }}>{row.black}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default ChatBox;
