import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReportModal from '../../src/components/ReportModal.jsx';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('ReportModal', () => {
  const defaultProps = {
    opponentId: 'opp-1',
    gameId: 'game-1',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('chess_token', 'test-token');
  });

  it('should render 4 reason radio buttons', () => {
    render(<ReportModal {...defaultProps} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByText('Engine / Computer Use')).toBeInTheDocument();
    expect(screen.getByText('Stalling / Wasting Time')).toBeInTheDocument();
    expect(screen.getByText('Harassment / Abuse')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('should have submit button disabled without reason selected', () => {
    render(<ReportModal {...defaultProps} />);
    const submitBtn = screen.getByText('Submit Report');
    expect(submitBtn).toBeDisabled();
  });

  it('should enable submit button when reason is selected', () => {
    render(<ReportModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Engine / Computer Use'));
    const submitBtn = screen.getByText('Submit Report');
    expect(submitBtn).not.toBeDisabled();
  });

  it('should show success message on successful submission', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'report-1' }),
    });

    render(<ReportModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Engine / Computer Use'));
    fireEvent.click(screen.getByText('Submit Report'));

    await waitFor(() => {
      expect(screen.getByText(/report submitted successfully/i)).toBeInTheDocument();
    });
  });

  it('should show error message on failed submission', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    });

    render(<ReportModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Engine / Computer Use'));
    fireEvent.click(screen.getByText('Submit Report'));

    await waitFor(() => {
      expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
    });
  });

  it('should cap details textarea at 500 characters', () => {
    render(<ReportModal {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Additional context...');
    const longText = 'a'.repeat(600);

    fireEvent.change(textarea, { target: { value: longText } });

    expect(textarea.value).toHaveLength(500);
  });

  it('should call onClose when Cancel is clicked', () => {
    render(<ReportModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should call onClose when overlay is clicked', () => {
    render(<ReportModal {...defaultProps} />);
    const overlay = document.querySelector('.modal-overlay');
    fireEvent.click(overlay);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should NOT close when modal content is clicked', () => {
    render(<ReportModal {...defaultProps} />);
    const content = document.querySelector('.modal-content');
    fireEvent.click(content);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
