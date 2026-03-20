import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntroScreen } from './IntroScreen';

describe('IntroScreen', () => {
  it('should show game title and intro text', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);
    expect(screen.getByText('JSHACK.ME')).toBeDefined();
    expect(screen.getByText(/freelance operator/)).toBeDefined();
  });

  it('should show NEW GAME button', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);
    expect(screen.getByText('NEW GAME')).toBeDefined();
  });

  it('should not show CONTINUE when no existing game', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);
    expect(screen.queryByText('CONTINUE')).toBeNull();
  });

  it('should show CONTINUE when existing game exists', () => {
    const game = { seed: 'abc', workstationName: 'my-box' };
    render(<IntroScreen existingGame={game} onStart={vi.fn()} />);
    expect(screen.getByText('CONTINUE')).toBeDefined();
  });

  it('should call onStart with existing game when CONTINUE clicked', () => {
    const game = { seed: 'abc', workstationName: 'my-box' };
    const onStart = vi.fn();
    render(<IntroScreen existingGame={game} onStart={onStart} />);

    fireEvent.click(screen.getByText('CONTINUE'));

    expect(onStart).toHaveBeenCalledWith(game);
  });

  it('should show name input when NEW GAME clicked', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));

    expect(screen.getByPlaceholderText('my-machine')).toBeDefined();
  });

  it('should show error for empty name submission', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    fireEvent.click(screen.getByText('START'));

    expect(screen.getByText('Enter a name for your workstation')).toBeDefined();
  });

  it('should call onStart with generated seed and trimmed name', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    fireEvent.change(screen.getByPlaceholderText('my-machine'), {
      target: { value: 'Hacker Box' },
    });
    fireEvent.click(screen.getByText('START'));

    expect(onStart).toHaveBeenCalledTimes(1);
    const arg = onStart.mock.calls[0][0];
    expect(arg.workstationName).toBe('hacker-box');
    expect(arg.seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should go back to menu when BACK clicked', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    expect(screen.getByPlaceholderText('my-machine')).toBeDefined();

    fireEvent.click(screen.getByText('BACK'));
    expect(screen.getByText('NEW GAME')).toBeDefined();
  });

  it('should reject names with invalid characters', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    fireEvent.change(screen.getByPlaceholderText('my-machine'), {
      target: { value: '-bad-' },
    });
    fireEvent.click(screen.getByText('START'));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Use letters, numbers, and hyphens only')).toBeDefined();
  });

  it('should submit on Enter key', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    const input = screen.getByPlaceholderText('my-machine');
    fireEvent.change(input, { target: { value: 'testbox' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
