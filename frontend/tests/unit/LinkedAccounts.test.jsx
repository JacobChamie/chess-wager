/* eslint-disable no-undef */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../src/context/AuthContext.jsx';
import LinkedAccounts from '../../src/components/LinkedAccounts.jsx';
import LichessCallbackPage from '../../src/pages/LichessCallbackPage.jsx';

let originalFetch;

beforeEach(() => {
  originalFetch = global.fetch;
  localStorage.setItem('chess_token', 'test-token');
});

afterEach(() => {
  global.fetch = originalFetch;
  localStorage.clear();
  vi.clearAllMocks();
});

// --- LinkedAccounts component ---
describe('LinkedAccounts', () => {
  it('renders nothing when user is null', () => {
    useAuth.mockReturnValue({ user: null });
    const { container } = render(<LinkedAccounts />);
    expect(container.innerHTML).toBe('');
  });

  it('renders "Connect Lichess" button when no accounts linked', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accounts: [] }),
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getByText('Connect Lichess')).toBeInTheDocument();
    });
  });

  it('renders Chess.com username input when not linked', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accounts: [] }),
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Chess.com username')).toBeInTheDocument();
    });
  });

  it('shows linked Lichess account with ratings', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        accounts: [{
          platform: 'lichess',
          platform_username: 'alice_lichess',
          is_verified: true,
          verification_code: null,
          ratings: { blitz: 1500, rapid: 1600 },
          profile_url: 'https://lichess.org/@/alice_lichess',
        }],
      }),
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getByText('Lichess')).toBeInTheDocument();
      expect(screen.getByText('alice_lichess')).toBeInTheDocument();
      expect(screen.getByText('1500')).toBeInTheDocument();
      expect(screen.getByText('1600')).toBeInTheDocument();
    });
  });

  it('shows linked Chess.com account with Unlink button', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        accounts: [{
          platform: 'chess_com',
          platform_username: 'alice_chess',
          is_verified: true,
          verification_code: null,
          ratings: { blitz: 1200 },
          profile_url: 'https://www.chess.com/member/alice_chess',
        }],
      }),
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getByText('Chess.com')).toBeInTheDocument();
      expect(screen.getByText('alice_chess')).toBeInTheDocument();
      // Unlink buttons (one per linked account)
      expect(screen.getAllByText('Unlink').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows pending verification code for Chess.com', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        accounts: [{
          platform: 'chess_com',
          platform_username: 'alice_chess',
          is_verified: false,
          verification_code: 'abc12345',
          ratings: {},
          profile_url: null,
        }],
      }),
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeInTheDocument();
      expect(screen.getByText('Check Verification')).toBeInTheDocument();
    });
  });

  it('starts Chess.com verification on form submit', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Initial fetch accounts
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accounts: [] }),
        });
      }
      // POST /chesscom/start
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ verificationCode: 'test1234' }),
      });
    });

    render(<LinkedAccounts />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Chess.com username')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Chess.com username'), {
      target: { value: 'myuser' },
    });
    fireEvent.click(screen.getByText('Verify'));

    await waitFor(() => {
      expect(screen.getByText('test1234')).toBeInTheDocument();
    });
  });

  it('shows error when Chess.com verification fails', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accounts: [] }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Chess.com username not found' }),
      });
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Chess.com username')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Chess.com username'), {
      target: { value: 'baduser' },
    });
    fireEvent.click(screen.getByText('Verify'));

    await waitFor(() => {
      expect(screen.getByText('Chess.com username not found')).toBeInTheDocument();
    });
  });

  it('renders Refresh buttons for linked accounts', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        accounts: [
          {
            platform: 'lichess',
            platform_username: 'alice_lichess',
            is_verified: true,
            verification_code: null,
            ratings: { blitz: 1500 },
            profile_url: 'https://lichess.org/@/alice_lichess',
          },
          {
            platform: 'chess_com',
            platform_username: 'alice_chess',
            is_verified: true,
            verification_code: null,
            ratings: { blitz: 1200 },
            profile_url: 'https://www.chess.com/member/alice_chess',
          },
        ],
      }),
    });

    render(<LinkedAccounts />);
    await waitFor(() => {
      expect(screen.getAllByText('Refresh')).toHaveLength(2);
    });
  });
});

// --- LichessCallbackPage ---
describe('LichessCallbackPage', () => {
  it('shows error when code/state missing', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });

    render(
      <MemoryRouter initialEntries={['/auth/lichess/callback']}>
        <LichessCallbackPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Missing authorization code/)).toBeInTheDocument();
    });
  });

  it('shows error when not logged in', async () => {
    useAuth.mockReturnValue({ user: null });
    localStorage.removeItem('chess_token');

    render(
      <MemoryRouter initialEntries={['/auth/lichess/callback?code=abc&state=xyz']}>
        <LichessCallbackPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/must be logged in/)).toBeInTheDocument();
    });
  });

  it('shows success on successful callback', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        username: 'AliceLichess',
        ratings: { blitz: 1500 },
      }),
    });

    render(
      <MemoryRouter initialEntries={['/auth/lichess/callback?code=abc&state=xyz']}>
        <LichessCallbackPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/AliceLichess.*linked successfully/)).toBeInTheDocument();
    });
  });

  it('shows error on failed callback', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid or expired state' }),
    });

    render(
      <MemoryRouter initialEntries={['/auth/lichess/callback?code=abc&state=xyz']}>
        <LichessCallbackPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Invalid or expired state')).toBeInTheDocument();
    });
  });

  it('renders Back to Lobby button on error', async () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Failed' }),
    });

    render(
      <MemoryRouter initialEntries={['/auth/lichess/callback?code=abc&state=xyz']}>
        <LichessCallbackPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Back to Lobby')).toBeInTheDocument();
    });
  });
});
