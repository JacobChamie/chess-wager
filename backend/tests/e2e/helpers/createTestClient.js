import { io as ioc } from 'socket.io-client';

/**
 * Connect a socket.io-client to the test server.
 * Resolves with the connected socket.
 */
export function connectClient(url, sessionId) {
  return new Promise((resolve, reject) => {
    const socket = ioc(url, {
      auth: { sessionId },
      forceNew: true,
      transports: ['websocket'],
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Connection timeout'));
    }, 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Wait for a single event on a socket. Rejects on timeout.
 */
export function waitForEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeout);
    const handler = (data) => {
      clearTimeout(timer);
      resolve(data);
    };
    socket.once(event, handler);
  });
}

/**
 * Collect N occurrences of an event. Rejects on timeout.
 */
export function collectEvents(socket, event, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const results = [];
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout collecting ${count} "${event}" events (got ${results.length})`));
    }, timeout);
    const handler = (data) => {
      results.push(data);
      if (results.length >= count) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(results);
      }
    };
    socket.on(event, handler);
  });
}

/**
 * Disconnect a single client. Resolves when disconnect completes.
 */
export function disconnectClient(socket) {
  return new Promise((resolve) => {
    if (socket.disconnected) {
      resolve();
      return;
    }
    socket.on('disconnect', () => resolve());
    socket.disconnect();
  });
}

/**
 * Disconnect all clients in the array.
 */
export async function disconnectAll(clients) {
  await Promise.all(clients.map((c) => disconnectClient(c)));
}
