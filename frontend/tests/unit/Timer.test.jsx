import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Timer from '../../src/components/timer.jsx';

describe('Timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders player name', () => {
    render(<Timer timeMs={300000} player="Alice" active={false} resultIcon={null} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('formats time correctly (300000ms → "5:00")', () => {
    render(<Timer timeMs={300000} player="Alice" active={false} resultIcon={null} />);
    expect(screen.getByText('5:00')).toBeInTheDocument();
  });

  it('formats low time with tenths (5200ms → "5.2")', () => {
    render(<Timer timeMs={5200} player="Alice" active={false} resultIcon={null} />);
    expect(screen.getByText('5.2')).toBeInTheDocument();
  });

  it('shows result icon when provided (win crown)', () => {
    render(<Timer timeMs={300000} player="Alice" active={false} resultIcon="win" />);
    expect(screen.getByText('\u{1F451}')).toBeInTheDocument();
  });

  it('shows loss icon', () => {
    render(<Timer timeMs={300000} player="Alice" active={false} resultIcon="loss" />);
    expect(screen.getByText('\u2717')).toBeInTheDocument();
  });

  it('shows draw icon', () => {
    render(<Timer timeMs={300000} player="Alice" active={false} resultIcon="draw" />);
    expect(screen.getByText('\u00BD')).toBeInTheDocument();
  });

  it('counts down when active', () => {
    render(<Timer timeMs={60000} player="Alice" active={true} resultIcon={null} />);
    expect(screen.getByText('1:00')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText('0:59')).toBeInTheDocument();
  });

  it('does not count down when inactive', () => {
    render(<Timer timeMs={60000} player="Alice" active={false} resultIcon={null} />);
    expect(screen.getByText('1:00')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('1:00')).toBeInTheDocument();
  });

  it('snaps to authoritative time when becoming inactive', () => {
    const { rerender } = render(
      <Timer timeMs={60000} player="Alice" active={true} resultIcon={null} />
    );

    act(() => { vi.advanceTimersByTime(5000); });
    // Should have counted down ~5s
    expect(screen.getByText('0:55')).toBeInTheDocument();

    // Server says 54 seconds left, turn ends
    rerender(<Timer timeMs={54000} player="Alice" active={false} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('0:54')).toBeInTheDocument();
  });

  it('uses correct baseRef when reactivated after turn cycle (regression test)', () => {
    // This tests the core bug: timer shows stale initial time after turn cycle
    // Scenario: opponent timer starts at 60s, goes inactive at 50s, reactivates at 50s
    const { rerender } = render(
      <Timer timeMs={60000} player="Opponent" active={false} resultIcon={null} />
    );
    expect(screen.getByText('1:00')).toBeInTheDocument();

    // Turn 1: opponent's turn starts (active=true), timeMs stays 60000
    rerender(<Timer timeMs={60000} player="Opponent" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('0:57')).toBeInTheDocument();

    // Turn 1 ends: opponent made a move, server says 50s left
    rerender(<Timer timeMs={50000} player="Opponent" active={false} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('0:50')).toBeInTheDocument();

    // Turn 2: opponent's turn again. Server sends timeMs=50000
    rerender(<Timer timeMs={50000} player="Opponent" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(200); });
    // MUST show ~50s, NOT ~60s (the old bug would show ~1:00 here)
    const timeDisplay = screen.getByText(/\d/).closest('.timer-time-display');
    const text = timeDisplay.textContent;
    // Should be close to 0:50, definitely not 1:00
    expect(text).toMatch(/^0:4[89]|^0:50/);

    // After more time, should keep counting down from 50s
    act(() => { vi.advanceTimersByTime(5000); });
    const text2 = screen.getByText(/\d/).closest('.timer-time-display').textContent;
    expect(text2).toMatch(/^0:4[45]/);
  });

  it('handles multiple turn cycles correctly', () => {
    const { rerender } = render(
      <Timer timeMs={60000} player="P" active={false} resultIcon={null} />
    );

    // Cycle 1: active at 60s
    rerender(<Timer timeMs={60000} player="P" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(5000); });

    // Inactive at 55s
    rerender(<Timer timeMs={55000} player="P" active={false} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText('0:55')).toBeInTheDocument();

    // Cycle 2: active at 55s
    rerender(<Timer timeMs={55000} player="P" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(5000); });

    // Inactive at 50s
    rerender(<Timer timeMs={50000} player="P" active={false} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText('0:50')).toBeInTheDocument();

    // Cycle 3: active at 50s
    rerender(<Timer timeMs={50000} player="P" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(5000); });

    // Inactive at 45s
    rerender(<Timer timeMs={45000} player="P" active={false} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText('0:45')).toBeInTheDocument();
  });

  it('handles timeMs unchanged between turns (same value, different active)', () => {
    // Server sends same timeMs because no time elapsed (very fast move)
    const { rerender } = render(
      <Timer timeMs={60000} player="P" active={true} resultIcon={null} />
    );
    act(() => { vi.advanceTimersByTime(2000); });

    // Turn off with 58s
    rerender(<Timer timeMs={58000} player="P" active={false} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(100); });

    // Turn on with same 58s (timeMs dep unchanged)
    rerender(<Timer timeMs={58000} player="P" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(3000); });

    const display = screen.getByText(/\d/).closest('.timer-time-display').textContent;
    // Should be ~55s, not 58s or 60s
    expect(display).toMatch(/^0:5[45]/);
  });

  it('never shows negative time', () => {
    render(<Timer timeMs={500} player="P" active={true} resultIcon={null} />);
    act(() => { vi.advanceTimersByTime(2000); });
    const display = screen.getByText(/\d/).closest('.timer-time-display').textContent;
    expect(display).toBe('0.0');
  });

  it('applies premium styling', () => {
    render(<Timer timeMs={60000} player="Alice" active={false} resultIcon={null} isPremium={true} />);
    const nameEl = screen.getByText(/Alice/);
    expect(nameEl.style.color).toBe('rgb(255, 215, 0)');
  });

  it('applies correct CSS class for active state', () => {
    const { container } = render(
      <Timer timeMs={60000} player="P" active={true} resultIcon={null} />
    );
    expect(container.querySelector('.timer--active')).toBeTruthy();
  });

  it('applies correct CSS class for low time active state', () => {
    const { container } = render(
      <Timer timeMs={15000} player="P" active={true} resultIcon={null} />
    );
    expect(container.querySelector('.timer--low')).toBeTruthy();
  });

  it('applies correct CSS class for inactive state', () => {
    const { container } = render(
      <Timer timeMs={60000} player="P" active={false} resultIcon={null} />
    );
    expect(container.querySelector('.timer--inactive')).toBeTruthy();
  });
});
