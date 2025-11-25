// src/components/chatbox.jsx
import React, { useState } from 'react';

const ChatBox = ({ userId, moves = [] }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'moves'

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [...prev, `${userId}: ${trimmed}`]);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const tabButtonStyle = (tab) => ({
    flex: 1,
    padding: '8px 0',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #4caf50' : '2px solid #444',
    backgroundColor: '#2a2a2a',
    color: activeTab === tab ? '#ffffff' : '#bbbbbb',
    cursor: 'pointer',
    fontWeight: activeTab === tab ? 'bold' : 'normal',
    fontSize: '0.9rem',
  });

  return (
    <div
      style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '12px',
        padding: '16px',
        width: '360px',
        color: '#f5f5f5',
        boxShadow: '0 0 15px rgba(0,0,0,0.5)',
      }}
    >
      {/* Tabs header */}
      <div style={{ display: 'flex', marginBottom: '12px' }}>
        <button
          style={tabButtonStyle('chat')}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          style={tabButtonStyle('moves')}
          onClick={() => setActiveTab('moves')}
        >
          Moves
        </button>
      </div>

      {/* CONTENT AREA */}
      {activeTab === 'chat' ? (
        <>
          <div
            style={{
              height: '260px',
              overflowY: 'auto',
              marginBottom: '12px',
              backgroundColor: '#1e1e1e',
              padding: '10px',
              borderRadius: '8px',
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: '#888', fontSize: '0.9rem' }}>
                No messages yet. Say hi!
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{ marginBottom: '6px', fontSize: '0.95rem' }}
              >
                {msg}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message"
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #555',
                backgroundColor: '#2a2a2a',
                color: '#fff',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSend}
              style={{
                marginLeft: '8px',
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4caf50',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Send
            </button>
          </div>
        </>
      ) : (
        // MOVES TAB
        <div
          style={{
            height: '300px',
            overflowY: 'auto',
            backgroundColor: '#1e1e1e',
            padding: '10px',
            borderRadius: '8px',
          }}
        >
          {moves.length === 0 ? (
            <div style={{ color: '#888', fontSize: '0.9rem' }}>
              No moves yet.
            </div>
          ) : (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.9rem',
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      paddingBottom: '6px',
                      borderBottom: '1px solid #444',
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      paddingBottom: '6px',
                      borderBottom: '1px solid #444',
                    }}
                  >
                    White
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      paddingBottom: '6px',
                      borderBottom: '1px solid #444',
                    }}
                  >
                    Black
                  </th>
                </tr>
              </thead>
              <tbody>
                {moves.map((row) => (
                  <tr key={row.moveNumber}>
                    <td
                      style={{
                        padding: '4px 4px 4px 0',
                        color: '#ccc',
                        width: '10%',
                      }}
                    >
                      {row.moveNumber}.
                    </td>
                    <td style={{ padding: '4px', width: '45%' }}>
                      {row.white}
                    </td>
                    <td style={{ padding: '4px', width: '45%' }}>
                      {row.black}
                    </td>
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
