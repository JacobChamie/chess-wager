import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock only what SettingsModal needs — useAuth, LinkedAccounts
vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../src/components/LinkedAccounts.jsx', () => ({
  default: () => <div data-testid="linked-accounts" />,
}));

import { useAuth } from '../../src/context/AuthContext.jsx';
import SettingsModal from '../../src/components/SettingsModal.jsx';

describe('SettingsModal — Animation Speed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders all 4 animation speed buttons', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Test', animation_speed: 'normal' }, updateProfile: vi.fn() });
    render(
      <MemoryRouter>
        <SettingsModal onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Instant')).toBeInTheDocument();
    expect(screen.getByText('Fast')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('Slow')).toBeInTheDocument();
  });

  it('renders ms labels for each speed', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Test', animation_speed: 'normal' }, updateProfile: vi.fn() });
    render(
      <MemoryRouter>
        <SettingsModal onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByText('0ms')).toBeInTheDocument();
    expect(screen.getByText('100ms')).toBeInTheDocument();
    expect(screen.getByText('200ms')).toBeInTheDocument();
    expect(screen.getByText('400ms')).toBeInTheDocument();
  });

  it('saves animation speed to localStorage on save', async () => {
    const updateProfile = vi.fn().mockResolvedValue({});
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Test', animation_speed: 'normal' }, updateProfile });
    render(
      <MemoryRouter>
        <SettingsModal onClose={vi.fn()} />
      </MemoryRouter>
    );

    // Click "Fast" speed
    fireEvent.click(screen.getByText('Fast'));
    // Click Save
    fireEvent.click(screen.getByText('Save'));

    // localStorage should be updated
    expect(localStorage.getItem('chess_animation_speed')).toBe('fast');
    // updateProfile should be called with animation_speed as 4th arg
    expect(updateProfile).toHaveBeenCalledWith('Test', 'default', 'default', 'fast');
  });

  it('defaults to normal speed when no setting exists', () => {
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Test' }, updateProfile: vi.fn() });
    render(
      <MemoryRouter>
        <SettingsModal onClose={vi.fn()} />
      </MemoryRouter>
    );
    // The "Normal" button should have a selected border
    const buttons = screen.getAllByRole('button');
    const normalBtn = buttons.find((b) => b.textContent.includes('Normal'));
    expect(normalBtn).toBeTruthy();
    expect(normalBtn.style.border).toContain('var(--accent)');
  });

  it('reads initial speed from localStorage', () => {
    localStorage.setItem('chess_animation_speed', 'slow');
    useAuth.mockReturnValue({ user: { id: 'u1', username: 'Test' }, updateProfile: vi.fn() });
    render(
      <MemoryRouter>
        <SettingsModal onClose={vi.fn()} />
      </MemoryRouter>
    );
    const buttons = screen.getAllByRole('button');
    const slowBtn = buttons.find((b) => b.textContent.includes('Slow'));
    expect(slowBtn).toBeTruthy();
    expect(slowBtn.style.border).toContain('var(--accent)');
  });
});
