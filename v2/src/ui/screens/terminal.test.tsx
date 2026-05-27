import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Terminal } from './terminal';
import { resetTerminal } from '../state';

/** Fresh terminal state per test — the scrollback signal is a module
 *  singleton, so reset it rather than leaking output between tests. */
const renderTerminal = () => {
  resetTerminal();
  return render(() => <Terminal />);
};

describe('Terminal', () => {
  it('runs cat against the seeded filesystem and shows the file contents', async () => {
    renderTerminal();
    const input = screen.getByRole('textbox', { name: /terminal input/i });

    fireEvent.input(input, { target: { value: 'cat /etc/passwd' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/alice:hunter2/)).toBeInTheDocument();
  });

  it('shows "command not found" for an unknown command', async () => {
    renderTerminal();
    const input = screen.getByRole('textbox', { name: /terminal input/i });

    fireEvent.input(input, { target: { value: 'frobnicate' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/command not found/i)).toBeInTheDocument();
  });
});
