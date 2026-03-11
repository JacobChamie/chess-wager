import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useAuth
vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

// Mock SettingsModal to avoid complex dependencies
vi.mock('../../src/components/SettingsModal.jsx', () => ({
  default: ({ onClose }) => <div data-testid="settings-modal"><button onClick={onClose}>Close</button></div>,
}));

import { useAuth } from '../../src/context/AuthContext.jsx';
import BottomNav from '../../src/components/BottomNav.jsx';

describe('BottomNav', () => {
  let originalInnerWidth;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: null });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true });
  });

  function setMobile() {
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });
  }

  function setDesktop() {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
  }

  function renderNav(path = '/') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <BottomNav />
      </MemoryRouter>
    );
  }

  it('should render nothing on desktop', () => {
    setDesktop();
    const { container } = renderNav();
    expect(container.innerHTML).toBe('');
  });

  it('should render on mobile', () => {
    setMobile();
    renderNav();
    expect(screen.getByText('Play')).toBeInTheDocument();
    expect(screen.getByText('Rank')).toBeInTheDocument();
    expect(screen.getByText('Wallet')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should not render on game pages', () => {
    setMobile();
    const { container } = renderNav('/game/abc-123');
    expect(container.innerHTML).toBe('');
  });

  it('should not show admin tab for non-admin users', () => {
    setMobile();
    useAuth.mockReturnValue({ user: { id: 'u1', is_admin: false } });
    renderNav();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('should show admin tab for admin users', () => {
    setMobile();
    useAuth.mockReturnValue({ user: { id: 'u1', is_admin: true } });
    renderNav();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('should open settings modal on Settings click', () => {
    setMobile();
    renderNav();
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  });

  it('should highlight Play tab on home path', () => {
    setMobile();
    renderNav('/');
    const playBtn = screen.getByText('Play').closest('button');
    expect(playBtn.className).toContain('active');
  });

  it('should highlight Rank tab on leaderboard path', () => {
    setMobile();
    renderNav('/leaderboard');
    const rankBtn = screen.getByText('Rank').closest('button');
    expect(rankBtn.className).toContain('active');
  });
});
