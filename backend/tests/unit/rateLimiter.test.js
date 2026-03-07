import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from '../../src/utils/rateLimiter.js';

describe('rateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows events within limit', () => {
    const limiter = createRateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) {
      expect(limiter('socket1')).toBe(true);
    }
  });

  it('blocks events exceeding limit', () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(false);
  });

  it('resets after window expires', () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(limiter('socket1')).toBe(true);
  });

  it('tracks different sockets independently', () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(true);
    expect(limiter('socket1')).toBe(false);

    // socket2 should still be allowed
    expect(limiter('socket2')).toBe(true);
  });

  it('sliding window: partial expiry', () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter('s1')).toBe(true); // t=0
    vi.advanceTimersByTime(500);
    expect(limiter('s1')).toBe(true); // t=500
    vi.advanceTimersByTime(300);
    expect(limiter('s1')).toBe(true); // t=800
    expect(limiter('s1')).toBe(false); // blocked

    // Advance so first event (t=0) expires but second (t=500) doesn't
    vi.advanceTimersByTime(300); // now t=1100
    expect(limiter('s1')).toBe(true); // first event expired, room for one more
  });
});
