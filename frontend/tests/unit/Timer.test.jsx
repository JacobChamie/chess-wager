import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Timer from '../../src/components/timer.jsx';

describe('Timer', () => {
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
});
