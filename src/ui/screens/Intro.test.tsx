import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Intro } from './Intro';

/**
 * The intro screen is a dumb component with two steps: a menu (intro copy +
 * NEW GAME) and a form (workstation / username / root password + confirm). It
 * calls `onSubmit(config)` only when the form is valid AND the passwords match.
 * Persistence + boot gating live in the boot gate; tests here cover the two-step
 * flow, the validation gate, and the emitted config — not storage.
 */

const startNewGame = () => {
  fireEvent.click(screen.getByRole('button', { name: /new game/i }));
};

const fillField = (name: RegExp, value: string) => {
  fireEvent.input(screen.getByLabelText(name), { target: { value } });
};

const fillValidForm = (
  overrides?: Partial<Record<'workstation' | 'username' | 'password' | 'confirm', string>>,
) => {
  fillField(/workstation/i, overrides?.workstation ?? 'skylab');
  fillField(/username/i, overrides?.username ?? 'alice');
  fillField(/^root password/i, overrides?.password ?? 'hunter2');
  fillField(/confirm password/i, overrides?.confirm ?? 'hunter2');
};

const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: /start/i }));
};

describe('Intro — menu step', () => {
  it('shows the menu with a NEW GAME action first, not the form', () => {
    render(() => <Intro onSubmit={vi.fn()} />);

    expect(screen.getByRole('button', { name: /new game/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/workstation/i)).not.toBeInTheDocument();
  });

  it('reveals the form after clicking NEW GAME', () => {
    render(() => <Intro onSubmit={vi.fn()} />);
    startNewGame();

    expect(screen.getByLabelText(/workstation/i)).toBeInTheDocument();
  });

  it('returns to the menu from the form via BACK', () => {
    render(() => <Intro onSubmit={vi.fn()} />);
    startNewGame();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByRole('button', { name: /new game/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/workstation/i)).not.toBeInTheDocument();
  });
});

describe('Intro — form step', () => {
  it('calls onSubmit with the typed config when all fields are valid and passwords match', () => {
    const onSubmit = vi.fn();
    render(() => <Intro onSubmit={onSubmit} />);
    startNewGame();
    fillValidForm();
    submit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      machineName: 'skylab',
      username: 'alice',
      rootPassword: 'hunter2',
    });
  });

  it('does not call onSubmit and shows an error when the machine name is invalid', () => {
    const onSubmit = vi.fn();
    render(() => <Intro onSubmit={onSubmit} />);
    startNewGame();
    fillValidForm({ workstation: 'Bad Name' }); // uppercase + space
    submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/letters, numbers, and hyphens/i)).toBeInTheDocument();
  });

  it('does not call onSubmit and shows an error when the username is reserved', () => {
    const onSubmit = vi.fn();
    render(() => <Intro onSubmit={onSubmit} />);
    startNewGame();
    fillValidForm({ username: 'root' });
    submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/reserved system name/i)).toBeInTheDocument();
  });

  it('does not call onSubmit and shows an error when the password is too short', () => {
    const onSubmit = vi.fn();
    render(() => <Intro onSubmit={onSubmit} />);
    startNewGame();
    fillValidForm({ password: 'abc', confirm: 'abc' });
    submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 4 characters/i)).toBeInTheDocument();
  });

  it('does not call onSubmit and shows an error when the passwords do not match', () => {
    const onSubmit = vi.fn();
    render(() => <Intro onSubmit={onSubmit} />);
    startNewGame();
    fillValidForm({ password: 'hunter2', confirm: 'hunter3' });
    submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it('recovers: a corrected resubmit succeeds after a validation failure', () => {
    const onSubmit = vi.fn();
    render(() => <Intro onSubmit={onSubmit} />);
    startNewGame();
    fillValidForm({ username: 'root' });
    submit();
    expect(onSubmit).not.toHaveBeenCalled();

    fillField(/username/i, 'alice');
    submit();

    expect(onSubmit).toHaveBeenCalledWith({
      machineName: 'skylab',
      username: 'alice',
      rootPassword: 'hunter2',
    });
  });
});
