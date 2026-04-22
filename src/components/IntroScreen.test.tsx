import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntroScreen } from './IntroScreen';

const fillForm = (
  hostname: string,
  username: string,
  password: string,
  confirmPassword: string = password,
) => {
  fireEvent.click(screen.getByText('NEW GAME'));
  fireEvent.change(screen.getByPlaceholderText('my-machine'), { target: { value: hostname } });
  fireEvent.change(screen.getByPlaceholderText('hacker'), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText('password'), { target: { value: password } });
  fireEvent.change(screen.getByPlaceholderText('confirm password'), {
    target: { value: confirmPassword },
  });
};

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
    const game = {
      seed: 'abc',
      workstationName: 'my-box',
      username: 'testuser',
      rootPassword: 'testpass',
    };
    render(<IntroScreen existingGame={game} onStart={vi.fn()} />);
    expect(screen.getByText('CONTINUE')).toBeDefined();
  });

  it('should call onStart with existing game when CONTINUE clicked', () => {
    const game = {
      seed: 'abc',
      workstationName: 'my-box',
      username: 'testuser',
      rootPassword: 'testpass',
    };
    const onStart = vi.fn();
    render(<IntroScreen existingGame={game} onStart={onStart} />);

    fireEvent.click(screen.getByText('CONTINUE'));

    expect(onStart).toHaveBeenCalledWith(game, false);
  });

  it('should show all fields when NEW GAME clicked', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));

    expect(screen.getByPlaceholderText('my-machine')).toBeDefined();
    expect(screen.getByPlaceholderText('hacker')).toBeDefined();
    expect(screen.getByPlaceholderText('password')).toBeDefined();
    expect(screen.getByPlaceholderText('confirm password')).toBeDefined();
  });

  it('should mask the password fields', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));

    expect(screen.getByPlaceholderText('password').getAttribute('type')).toBe('password');
    expect(screen.getByPlaceholderText('confirm password').getAttribute('type')).toBe('password');
  });

  it('should reject when passwords do not match', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fillForm('box', 'user', 'pass1234', 'different');
    fireEvent.click(screen.getByText('START'));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Passwords do not match')).toBeDefined();
  });

  it('should show error for empty hostname', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    fireEvent.click(screen.getByText('START'));

    expect(screen.getByText('Enter a name for your workstation')).toBeDefined();
  });

  it('should reject hostnames with invalid characters', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fillForm('-bad-', 'user', 'pass1234');
    fireEvent.click(screen.getByText('START'));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Use letters, numbers, and hyphens only')).toBeDefined();
  });

  it('should reject reserved usernames', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fillForm('box', 'root', 'pass1234');
    fireEvent.click(screen.getByText('START'));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText(/"root" is a reserved system name/)).toBeDefined();
  });

  it('should reject short passwords', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fillForm('box', 'user', 'ab');
    fireEvent.click(screen.getByText('START'));

    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Password must be at least 4 characters')).toBeDefined();
  });

  it('should call onStart with all fields on valid submission', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fillForm('Hacker Box', 'myuser', 'mypass');
    fireEvent.click(screen.getByText('START'));

    expect(onStart).toHaveBeenCalledTimes(1);
    const arg = onStart.mock.calls[0][0];
    expect(arg.workstationName).toBe('hacker-box');
    expect(arg.username).toBe('myuser');
    expect(arg.rootPassword).toBe('mypass');
    expect(arg.seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should go back to menu when BACK clicked', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    expect(screen.getByPlaceholderText('my-machine')).toBeDefined();

    fireEvent.click(screen.getByText('BACK'));
    expect(screen.getByText('NEW GAME')).toBeDefined();
  });

  it('should submit on Enter key', () => {
    const onStart = vi.fn();
    render(<IntroScreen existingGame={null} onStart={onStart} />);

    fillForm('testbox', 'user', 'pass1234');
    fireEvent.keyDown(screen.getByPlaceholderText('password'), { key: 'Enter' });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('should show prompt preview when hostname and username are filled', () => {
    render(<IntroScreen existingGame={null} onStart={vi.fn()} />);

    fireEvent.click(screen.getByText('NEW GAME'));
    fireEvent.change(screen.getByPlaceholderText('my-machine'), { target: { value: 'mybox' } });
    fireEvent.change(screen.getByPlaceholderText('hacker'), { target: { value: 'alice' } });

    expect(screen.getByText('alice@mybox')).toBeDefined();
  });
});
