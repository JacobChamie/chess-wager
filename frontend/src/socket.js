import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Per-tab session identity (survives refresh, unique per tab)
let sessionId = sessionStorage.getItem('chess_session_id');
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem('chess_session_id', sessionId);
}

export { sessionId };

export const socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  auth: {
    sessionId,
    token: localStorage.getItem('chess_token'),
  },
});

export function updateSocketAuth(token) {
  socket.auth = {
    ...socket.auth,
    token: token || undefined,
  };
  // Reconnect with new auth if currently connected
  if (socket.connected) {
    socket.disconnect().connect();
  }
}
