import { useState, useRef, useEffect, useCallback } from 'react';
import { socket } from '../socket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { filterProfanity } from '../utils/profanityFilter.js';

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

/**
 * GlobalChat — renders as an inline panel (in LobbyPage) or as a floating widget (in App.jsx).
 * Props:
 *   floating — if true, renders as fixed-position floating panel with minimize/close
 */
const GlobalChat = ({ floating = false }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [error, setError] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [unread, setUnread] = useState(0);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const canSend = user && user.email_verified;

  const getProfanityEnabled = useCallback(() => {
    const stored = localStorage.getItem('chess_profanity_filter');
    if (stored !== null) return JSON.parse(stored);
    if (user?.profanity_filter !== undefined) return user.profanity_filter;
    return true;
  }, [user]);

  const applyFilter = useCallback((text) => {
    return getProfanityEnabled() ? filterProfanity(text) : text;
  }, [getProfanityEnabled]);

  useEffect(() => {
    socket.emit('global:chat:history');

    const onHistory = (history) => setMessages(history);
    const onMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (minimized) setUnread((c) => c + 1);
    };
    const onError = ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 4000);
    };

    socket.on('global:chat:history', onHistory);
    socket.on('global:chat:message', onMessage);
    socket.on('global:chat:error', onError);

    return () => {
      socket.off('global:chat:history', onHistory);
      socket.off('global:chat:message', onMessage);
      socket.off('global:chat:error', onError);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!minimized) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, minimized]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    socket.emit('global:chat:send', { message: trimmed });
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

  const getPlaceholder = () => {
    if (!user) return 'Sign in to chat';
    if (!user.email_verified) return 'Verify email to chat';
    return 'Type a message';
  };

  const handleExpand = () => {
    setMinimized(false);
    setUnread(0);
  };

  // Floating minimized pill
  if (floating && minimized) {
    return (
      <button
        className="global-chat-fab"
        onClick={handleExpand}
      >
        Lobby Chat{unread > 0 && ` (${unread})`}
      </button>
    );
  }

  const chatContent = (
    <div className={floating ? 'global-chat global-chat--floating' : 'global-chat'}>
      <div className="global-chat-header">
        <span>Lobby Chat</span>
        {floating && (
          <button
            className="global-chat-minimize"
            onClick={() => setMinimized(true)}
            title="Minimize"
          >
            &mdash;
          </button>
        )}
      </div>

      <div className="chatbox-messages">
        {messages.length === 0 && (
          <div className="chatbox-empty">No messages yet</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="chatbox-msg">
            <div className="chatbox-msg-header">
              <span
                className="chatbox-msg-name"
                style={msg.isPremium
                  ? { color: '#ffd700', textShadow: '0 0 6px rgba(255,215,0,0.4)', fontWeight: 700 }
                  : { color: '#64b5f6' }}
              >
                {msg.isPremium && '\u2605 '}{msg.senderName}
              </span>
              <span className="chatbox-msg-time">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="chatbox-msg-body">{applyFilter(msg.message)}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {error && (
        <div style={{
          padding: '6px 12px',
          fontSize: '12px',
          color: '#ef5350',
          background: 'rgba(229, 57, 53, 0.1)',
          borderTop: '1px solid var(--border)',
        }}>
          {error}
        </div>
      )}

      {showEmojis && canSend && (
        <div className="chatbox-emoji-grid">
          {EMOJI_GRID.map((emoji) => (
            <button key={emoji} onClick={() => insertEmoji(emoji)} className="chatbox-emoji-btn">
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="chatbox-input-row">
        <input
          ref={inputRef}
          className="input input-sm"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={!canSend}
          style={{ flex: 1 }}
        />
        {canSend && (
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
        )}
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSend}
          disabled={!canSend}
        >
          Send
        </button>
      </div>
    </div>
  );

  return chatContent;
};

export default GlobalChat;
