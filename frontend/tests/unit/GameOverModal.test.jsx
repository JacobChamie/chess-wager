import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameOverModal from '../../src/components/GameOverModal.jsx';

const defaultProps = {
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
};

describe('GameOverModal', () => {
  it('shows "You Won!" when winner === myColor', () => {
    render(<GameOverModal {...defaultProps} winner="w" myColor="w" />);
    expect(screen.getByText('You Won!')).toBeInTheDocument();
  });

  it('shows "You Lost" when winner !== myColor', () => {
    render(<GameOverModal {...defaultProps} winner="b" myColor="w" />);
    expect(screen.getByText('You Lost')).toBeInTheDocument();
  });

  it('shows "Draw" when winner is null', () => {
    render(<GameOverModal {...defaultProps} winner={null} result="1/2-1/2" reason="stalemate" />);
    expect(screen.getByText('Draw')).toBeInTheDocument();
  });

  it('calls onBackToLobby when Back to Lobby clicked', () => {
    const onBackToLobby = vi.fn();
    render(<GameOverModal {...defaultProps} onBackToLobby={onBackToLobby} />);
    fireEvent.click(screen.getByText('Back to Lobby'));
    expect(onBackToLobby).toHaveBeenCalledTimes(1);
  });

  it('shows "Rematch" button when no pending offer', () => {
    render(<GameOverModal {...defaultProps} rematchOffer={null} />);
    expect(screen.getByText('Rematch')).toBeInTheDocument();
  });
});
