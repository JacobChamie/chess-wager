import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClockManager } from '../../src/game/ClockManager.js';

describe('ClockManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with number time control (seconds → ms)', () => {
    const clock = new ClockManager(300, null);
    expect(clock.whiteTimeMs).toBe(300_000);
    expect(clock.blackTimeMs).toBe(300_000);
    expect(clock.incrementMs).toBe(0);
  });

  it('initializes with object { time, increment }', () => {
    const clock = new ClockManager({ time: 180, increment: 2 }, null);
    expect(clock.whiteTimeMs).toBe(180_000);
    expect(clock.blackTimeMs).toBe(180_000);
    expect(clock.incrementMs).toBe(2_000);
  });

  it('start() sets activeSide and records timestamp', () => {
    const clock = new ClockManager(300, null);
    clock.start('w');
    expect(clock.activeSide).toBe('w');
    expect(clock.lastSwitchTimestamp).toBe(Date.now());
  });

  it('switchTurn() deducts elapsed time from active side', () => {
    const clock = new ClockManager(300, null);
    clock.start('w');
    vi.advanceTimersByTime(5000);
    clock.switchTurn();
    expect(clock.whiteTimeMs).toBe(295_000);
    expect(clock.activeSide).toBe('b');
  });

  it('switchTurn() adds increment after switching', () => {
    const clock = new ClockManager({ time: 180, increment: 2 }, null);
    clock.start('w');
    vi.advanceTimersByTime(3000);
    clock.switchTurn();
    // 180000 - 3000 + 2000 = 179000
    expect(clock.whiteTimeMs).toBe(179_000);
    expect(clock.activeSide).toBe('b');
  });

  it('switchTurn() does nothing if activeSide is null', () => {
    const clock = new ClockManager(300, null);
    clock.switchTurn();
    expect(clock.whiteTimeMs).toBe(300_000);
    expect(clock.blackTimeMs).toBe(300_000);
  });

  it('pause() freezes time and clears active side', () => {
    const clock = new ClockManager(300, null);
    clock.start('w');
    vi.advanceTimersByTime(10_000);
    clock.pause();
    expect(clock.whiteTimeMs).toBe(290_000);
    expect(clock.activeSide).toBeNull();
    // After pausing, time shouldn't change
    vi.advanceTimersByTime(5000);
    expect(clock.whiteTimeMs).toBe(290_000);
  });

  it('getTimesMs() returns stored times when paused', () => {
    const clock = new ClockManager(300, null);
    const times = clock.getTimesMs();
    expect(times.whiteTime).toBe(300_000);
    expect(times.blackTime).toBe(300_000);
  });

  it('getTimesMs() deducts live elapsed for active side', () => {
    const clock = new ClockManager(300, null);
    clock.start('w');
    vi.advanceTimersByTime(7000);
    const times = clock.getTimesMs();
    expect(times.whiteTime).toBe(293_000);
    expect(times.blackTime).toBe(300_000);
  });

  it('fires onTimeout when time expires', () => {
    const onTimeout = vi.fn();
    const clock = new ClockManager(5, onTimeout); // 5 seconds
    clock.start('w');
    vi.advanceTimersByTime(5000);
    expect(onTimeout).toHaveBeenCalledWith('w');
    expect(clock.whiteTimeMs).toBe(0);
  });

  it('destroy() clears timeout and prevents callback', () => {
    const onTimeout = vi.fn();
    const clock = new ClockManager(5, onTimeout);
    clock.start('w');
    clock.destroy();
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
