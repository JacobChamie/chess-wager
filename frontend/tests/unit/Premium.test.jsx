import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useAuth
vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

// Mock socket for Navbar
vi.mock('../../src/socket.js', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  sessionId: 'test-session',
}));

// Mock SettingsModal
vi.mock('../../src/components/SettingsModal.jsx', () => ({
  default: ({ onClose }) => <div data-testid="settings-modal"><button onClick={onClose}>Close</button></div>,
}));

// Mock AuthModal
vi.mock('../../src/components/AuthModal.jsx', () => ({
  default: ({ onClose }) => <div data-testid="auth-modal"><button onClick={onClose}>Close</button></div>,
}));

// Mock BalanceDisplay
vi.mock('../../src/components/BalanceDisplay.jsx', () => ({
  default: () => <span data-testid="balance">100 tok</span>,
}));

// Mock LinkedAccounts
vi.mock('../../src/components/LinkedAccounts.jsx', () => ({
  default: () => <div data-testid="linked-accounts" />,
}));

import { useAuth } from '../../src/context/AuthContext.jsx';

describe('Timer — isPremium', () => {
  // Import Timer after mocks
  let Timer;
  beforeEach(async () => {
    const mod = await import('../../src/components/timer.jsx');
    Timer = mod.default;
  });

  it('renders star prefix when isPremium is true', () => {
    render(<Timer timeMs={300000} player="Alice" active={false} resultIcon={null} isPremium={true} />);
    const nameEl = document.querySelector('.timer-player-name');
    expect(nameEl.textContent).toContain('\u2605');
    expect(nameEl.textContent).toContain('Alice');
  });

  it('does not render star when isPremium is false', () => {
    render(<Timer timeMs={300000} player="Bob" active={false} resultIcon={null} isPremium={false} />);
    const nameEl = document.querySelector('.timer-player-name');
    expect(nameEl.textContent).not.toContain('\u2605');
    expect(nameEl.textContent).toContain('Bob');
  });

  it('applies gold styling when isPremium is true', () => {
    render(<Timer timeMs={300000} player="Gold" active={false} resultIcon={null} isPremium={true} />);
    const nameEl = document.querySelector('.timer-player-name');
    expect(nameEl.style.color).toBe('rgb(255, 215, 0)');
    expect(nameEl.style.fontWeight).toBe('700');
  });

  it('does not apply gold styling when isPremium is false', () => {
    render(<Timer timeMs={300000} player="Free" active={false} resultIcon={null} isPremium={false} />);
    const nameEl = document.querySelector('.timer-player-name');
    expect(nameEl.style.color).not.toBe('rgb(255, 215, 0)');
  });
});

describe('BottomNav — Premium tab', () => {
  let BottomNav;
  let originalInnerWidth;

  beforeEach(async () => {
    originalInnerWidth = window.innerWidth;
    vi.clearAllMocks();
    const mod = await import('../../src/components/BottomNav.jsx');
    BottomNav = mod.default;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true });
  });

  function setMobile() {
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });
  }

  function renderNav(path = '/') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <BottomNav />
      </MemoryRouter>
    );
  }

  it('shows Premium tab for non-premium logged-in user', () => {
    setMobile();
    useAuth.mockReturnValue({ user: { id: 'u1', is_premium: false } });
    renderNav();
    expect(screen.getByText('Premium')).toBeInTheDocument();
  });

  it('does not show Premium tab for premium user', () => {
    setMobile();
    useAuth.mockReturnValue({ user: { id: 'u1', is_premium: true } });
    renderNav();
    expect(screen.queryByText('Premium')).not.toBeInTheDocument();
  });

  it('does not show Premium tab for logged-out user', () => {
    setMobile();
    useAuth.mockReturnValue({ user: null });
    renderNav();
    expect(screen.queryByText('Premium')).not.toBeInTheDocument();
  });
});

describe('Navbar — Premium display', () => {
  let Navbar;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/components/Navbar.jsx');
    Navbar = mod.default;
  });

  function renderNavbar() {
    return render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>
    );
  }

  it('shows "Go Premium" link for non-premium user', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Alice', is_premium: false, is_admin: false }, logout: vi.fn() });
    renderNavbar();
    expect(screen.getByText('Go Premium')).toBeInTheDocument();
  });

  it('does not show "Go Premium" for premium user', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Alice', is_premium: true, is_admin: false }, logout: vi.fn() });
    renderNavbar();
    expect(screen.queryByText('Go Premium')).not.toBeInTheDocument();
  });

  it('does not show "Go Premium" for admin user', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Admin', is_premium: false, is_admin: true }, logout: vi.fn() });
    renderNavbar();
    expect(screen.queryByText('Go Premium')).not.toBeInTheDocument();
  });

  it('shows star prefix for premium username', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'GoldUser', is_premium: true, is_admin: false }, logout: vi.fn() });
    renderNavbar();
    const link = screen.getByText((content) => content.includes('GoldUser'));
    expect(link.textContent).toContain('\u2605');
  });
});

// SettingsModal animation speed tests are in AnimationSpeed.test.jsx
// (separate file to avoid mock conflicts with SettingsModal mock in this file)
