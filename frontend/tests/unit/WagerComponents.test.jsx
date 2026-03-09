import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GameOverModal from '../../src/components/GameOverModal.jsx';
import WagerSelector from '../../src/components/WagerSelector.jsx';
import BalanceDisplay from '../../src/components/BalanceDisplay.jsx';

// Mock useAuth for BalanceDisplay and WagerSelector
vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../src/context/AuthContext.jsx';

// --- GameOverModal Wager Tests ---

const baseModalProps = {
  result: '1-0',
  reason: 'checkmate',
  winner: 'w',
  myColor: 'w',
  rematchOffer: null,
  onRematch: vi.fn(),
  onRespondRematch: vi.fn(),
  onBackToLobby: vi.fn(),
  onDismiss: vi.fn(),
  isBotGame: false,
  botPersonality: null,
  isWagerGame: false,
  wagerAmount: 0,
};

describe('GameOverModal — Wager Display', () => {
  it('should show tokens won on wager game win', () => {
    render(
      <GameOverModal
        {...baseModalProps}
        isWagerGame={true}
        wagerAmount={25}
        winner="w"
        myColor="w"
      />
    );
    expect(screen.getByText(/Won 50 tokens!/)).toBeInTheDocument();
  });

  it('should show tokens lost on wager game loss', () => {
    render(
      <GameOverModal
        {...baseModalProps}
        isWagerGame={true}
        wagerAmount={25}
        winner="b"
        myColor="w"
      />
    );
    expect(screen.getByText(/Lost 25 tokens/)).toBeInTheDocument();
  });

  it('should show refund on wager game draw', () => {
    render(
      <GameOverModal
        {...baseModalProps}
        isWagerGame={true}
        wagerAmount={25}
        winner={null}
        result="1/2-1/2"
        reason="stalemate"
      />
    );
    expect(screen.getByText(/Wager refunded.*25 tokens/)).toBeInTheDocument();
  });

  it('should NOT show wager info on non-wager game', () => {
    render(
      <GameOverModal {...baseModalProps} isWagerGame={false} wagerAmount={0} />
    );
    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
  });
});

// --- WagerSelector Tests ---

describe('WagerSelector', () => {
  it('should render all wager options', () => {
    useAuth.mockReturnValue({ user: { token_balance: '100' } });
    const onChange = vi.fn();
    render(<WagerSelector value={0} onChange={onChange} />);

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('should highlight the selected value', () => {
    useAuth.mockReturnValue({ user: { token_balance: '100' } });
    const onChange = vi.fn();
    render(<WagerSelector value={10} onChange={onChange} />);

    const btn10 = screen.getByText('10');
    expect(btn10.className).toContain('btn-primary');
  });

  it('should call onChange when a tile is clicked', () => {
    useAuth.mockReturnValue({ user: { token_balance: '100' } });
    const onChange = vi.fn();
    render(<WagerSelector value={0} onChange={onChange} />);

    fireEvent.click(screen.getByText('25'));
    expect(onChange).toHaveBeenCalledWith(25);
  });

  it('should disable wager options exceeding balance', () => {
    useAuth.mockReturnValue({ user: { token_balance: '15' } });
    const onChange = vi.fn();
    render(<WagerSelector value={0} onChange={onChange} />);

    // 25, 50, 100 should be disabled (balance = 15)
    const btn25 = screen.getByText('25');
    expect(btn25).toBeDisabled();

    const btn50 = screen.getByText('50');
    expect(btn50).toBeDisabled();

    const btn100 = screen.getByText('100');
    expect(btn100).toBeDisabled();

    // 1, 5, 10 should be enabled
    expect(screen.getByText('1')).not.toBeDisabled();
    expect(screen.getByText('5')).not.toBeDisabled();
    expect(screen.getByText('10')).not.toBeDisabled();
  });

  it('should disable all wager options when not logged in', () => {
    useAuth.mockReturnValue({ user: null });
    const onChange = vi.fn();
    render(<WagerSelector value={0} onChange={onChange} />);

    // Free should always be enabled
    expect(screen.getByText('Free')).not.toBeDisabled();

    // All wager amounts should be disabled
    expect(screen.getByText('1')).toBeDisabled();
    expect(screen.getByText('10')).toBeDisabled();
    expect(screen.getByText('100')).toBeDisabled();
  });

  it('should show explanation text when wager is selected', () => {
    useAuth.mockReturnValue({ user: { token_balance: '100' } });
    render(<WagerSelector value={25} onChange={vi.fn()} />);

    expect(screen.getByText(/Each player wagers 25 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Winner takes 50/)).toBeInTheDocument();
  });

  it('should not show explanation text for free games', () => {
    useAuth.mockReturnValue({ user: { token_balance: '100' } });
    render(<WagerSelector value={0} onChange={vi.fn()} />);

    expect(screen.queryByText(/Each player wagers/)).not.toBeInTheDocument();
  });
});

// --- BalanceDisplay Tests ---

describe('BalanceDisplay', () => {
  it('should render balance for logged-in user', () => {
    useAuth.mockReturnValue({ user: { token_balance: '42.50' } });
    render(
      <MemoryRouter>
        <BalanceDisplay />
      </MemoryRouter>
    );
    expect(screen.getByText('42.50')).toBeInTheDocument();
  });

  it('should render nothing when user is null', () => {
    useAuth.mockReturnValue({ user: null });
    const { container } = render(
      <MemoryRouter>
        <BalanceDisplay />
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe('');
  });

  it('should show 0.00 for zero balance', () => {
    useAuth.mockReturnValue({ user: { token_balance: '0' } });
    render(
      <MemoryRouter>
        <BalanceDisplay />
      </MemoryRouter>
    );
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });

  it('should link to /wallet', () => {
    useAuth.mockReturnValue({ user: { token_balance: '10' } });
    render(
      <MemoryRouter>
        <BalanceDisplay />
      </MemoryRouter>
    );
    const link = screen.getByTitle(/Token balance/);
    expect(link).toHaveAttribute('href', '/wallet');
  });
});
