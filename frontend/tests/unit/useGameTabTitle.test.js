import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock canvas getContext since jsdom doesn't support it
const mockCtx = {
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  fillText: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
};
HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mock');

import { useGameTabTitle } from '../../src/hooks/useGameTabTitle.js';

describe('useGameTabTitle', () => {
  const originalTitle = document.title;

  beforeEach(() => {
    document.title = 'ELO Stakes';
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it('should not change title when status is null', () => {
    renderHook(() => useGameTabTitle(null));
    expect(document.title).toBe('ELO Stakes');
  });

  it('should set "Your turn" when active and isMyTurn', () => {
    renderHook(() =>
      useGameTabTitle({ status: 'active', isMyTurn: true, isSpectator: false })
    );
    expect(document.title).toBe('Your turn - ELO Stakes');
  });

  it('should set "Waiting..." when active and not my turn', () => {
    renderHook(() =>
      useGameTabTitle({ status: 'active', isMyTurn: false, isSpectator: false })
    );
    expect(document.title).toBe('Waiting... - ELO Stakes');
  });

  it('should set "Spectating" when active and spectator', () => {
    renderHook(() =>
      useGameTabTitle({ status: 'active', isMyTurn: false, isSpectator: true })
    );
    expect(document.title).toBe('Spectating - ELO Stakes');
  });

  it('should set "Game Over" when completed', () => {
    renderHook(() =>
      useGameTabTitle({ status: 'completed', isMyTurn: false, isSpectator: false })
    );
    expect(document.title).toBe('Game Over - ELO Stakes');
  });

  it('should restore title on unmount', () => {
    const { unmount } = renderHook(() =>
      useGameTabTitle({ status: 'active', isMyTurn: true, isSpectator: false })
    );
    expect(document.title).toBe('Your turn - ELO Stakes');
    unmount();
    expect(document.title).toBe('ELO Stakes');
  });
});
