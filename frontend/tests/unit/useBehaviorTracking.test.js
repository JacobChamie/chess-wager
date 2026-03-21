import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBehaviorTracking } from '../../src/hooks/useBehaviorTracking.js';

describe('useBehaviorTracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return getBehaviorData function', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));
    expect(typeof result.current).toBe('function');
  });

  it('should not register listeners when inactive', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderHook(() => useBehaviorTracking('game-1', false, false));
    // Should not add visibilitychange/copy/paste listeners
    const fairplayCalls = addSpy.mock.calls.filter(([event]) =>
      ['visibilitychange', 'copy', 'paste'].includes(event)
    );
    expect(fairplayCalls).toHaveLength(0);
    addSpy.mockRestore();
  });

  it('should not register listeners when spectator', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderHook(() => useBehaviorTracking('game-1', true, true));
    const fairplayCalls = addSpy.mock.calls.filter(([event]) =>
      ['visibilitychange', 'copy', 'paste'].includes(event)
    );
    expect(fairplayCalls).toHaveLength(0);
    addSpy.mockRestore();
  });

  it('should count tab switches on visibilitychange', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));

    const data = result.current();
    expect(data.tabSwitches).toBe(2);

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  it('should count focus losses on blur', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('blur'));

    const data = result.current();
    expect(data.focusLosses).toBe(3);
  });

  it('should count copy events', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));
    document.dispatchEvent(new Event('copy'));
    expect(result.current().copyEvents).toBe(1);
  });

  it('should count paste events', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));
    document.dispatchEvent(new Event('paste'));
    expect(result.current().pasteEvents).toBe(1);
  });

  it('should sample mouse position every 2 seconds', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));

    // Simulate mouse move
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 200 }));

    // Advance 4 seconds -> 2 samples
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    const data = result.current();
    expect(data.mousePositions.length).toBe(2);
    expect(data.mousePositions[0]).toEqual({ x: 100, y: 200 });
  });

  it('should cap mouse samples at 300', () => {
    const { result } = renderHook(() => useBehaviorTracking('game-1', true, false));

    // Advance enough to generate 310 samples (620 seconds)
    act(() => {
      vi.advanceTimersByTime(620 * 1000);
    });

    const data = result.current();
    expect(data.mousePositions.length).toBeLessThanOrEqual(300);
  });

  it('should reset data on gameId change', () => {
    const { result, rerender } = renderHook(
      ({ gameId }) => useBehaviorTracking(gameId, true, false),
      { initialProps: { gameId: 'game-1' } }
    );

    // Generate some data
    window.dispatchEvent(new Event('blur'));
    expect(result.current().focusLosses).toBe(1);

    // Change gameId -> should reset
    rerender({ gameId: 'game-2' });
    expect(result.current().focusLosses).toBe(0);
  });

  it('should clean up listeners on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useBehaviorTracking('game-1', true, false));

    unmount();

    const cleanupCalls = removeSpy.mock.calls.filter(([event]) =>
      ['visibilitychange', 'copy', 'paste'].includes(event)
    );
    expect(cleanupCalls.length).toBeGreaterThanOrEqual(3);
    removeSpy.mockRestore();
  });
});
