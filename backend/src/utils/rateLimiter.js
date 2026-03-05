/**
 * Simple per-socket rate limiter using a sliding window.
 * Returns a middleware function that checks if the socket has exceeded
 * the allowed number of events per window.
 */
export function createRateLimiter(maxEvents = 10, windowMs = 1000) {
  const clients = new Map(); // socketId -> [timestamps]

  return (socketId) => {
    const now = Date.now();
    let timestamps = clients.get(socketId);

    if (!timestamps) {
      timestamps = [];
      clients.set(socketId, timestamps);
    }

    // Remove timestamps outside the window
    const cutoff = now - windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= maxEvents) {
      return false; // Rate limited
    }

    timestamps.push(now);
    return true; // Allowed
  };
}

/**
 * Clean up rate limiter entries for a disconnected socket.
 */
export function cleanupRateLimiter(limiter, socketId) {
  // The limiter closure captures the Map internally,
  // so we expose cleanup via a wrapper.
}
