import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WagerGateSelector from '../../src/components/WagerGateSelector.jsx';

describe('WagerGateSelector', () => {
  const defaultGates = {};
  const onChange = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render nothing when visible is false', () => {
    const { container } = render(
      <WagerGateSelector gates={defaultGates} onChange={onChange} visible={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render when visible is true', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    expect(screen.getByText('Wager Requirements')).toBeInTheDocument();
  });

  it('should show the require verified checkbox', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    expect(screen.getByText(/Require verified account/)).toBeInTheDocument();
  });

  it('should call onChange when verified checkbox is toggled', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ requireVerified: true });
  });

  it('should uncheck verified when already checked', () => {
    render(
      <WagerGateSelector gates={{ requireVerified: true }} onChange={onChange} visible={true} />
    );
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ requireVerified: false });
  });

  it('should expand minimum rating section on button click', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    const btn = screen.getByText(/Set minimum rating/);
    fireEvent.click(btn);
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Time Control')).toBeInTheDocument();
    expect(screen.getByText('Min Rating')).toBeInTheDocument();
  });

  it('should toggle to hide when already expanded', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    const btn = screen.getByText(/Set minimum rating/);
    fireEvent.click(btn);
    expect(screen.getByText(/Hide minimum rating/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Hide minimum rating/));
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  it('should show platform options when expanded', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    fireEvent.click(screen.getByText(/Set minimum rating/));

    const platformSelect = screen.getAllByRole('combobox')[0];
    expect(platformSelect).toBeDefined();
    // Check options exist
    const options = platformSelect.querySelectorAll('option');
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain('chess.com');
    expect(values).toContain('lichess');
  });

  it('should call onChange when platform is selected', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    fireEvent.click(screen.getByText(/Set minimum rating/));

    const platformSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(platformSelect, { target: { value: 'lichess' } });
    expect(onChange).toHaveBeenCalledWith({ minExternalPlatform: 'lichess' });
  });

  it('should call onChange when min rating is entered', () => {
    render(<WagerGateSelector gates={defaultGates} onChange={onChange} visible={true} />);
    fireEvent.click(screen.getByText(/Set minimum rating/));

    const ratingInput = screen.getByPlaceholderText('e.g. 1500');
    fireEvent.change(ratingInput, { target: { value: '1500' } });
    expect(onChange).toHaveBeenCalledWith({ minExternalRating: 1500 });
  });
});
