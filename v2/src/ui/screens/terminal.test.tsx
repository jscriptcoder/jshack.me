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

const runCommand = (value: string) => {
  const field = screen.getByRole('textbox', { name: /terminal input/i });
  fireEvent.input(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
};

describe('Terminal', () => {
  it('echoes the typed command above its output', async () => {
    renderTerminal();
    runCommand('cat /etc/passwd');

    expect(await screen.findByText('alice@workstation> cat /etc/passwd')).toBeInTheDocument();
    expect(await screen.findByText(/alice:hunter2/)).toBeInTheDocument();
  });

  it('shows "command not found" for an unknown command', async () => {
    renderTerminal();
    runCommand('frobnicate');

    expect(await screen.findByText(/command not found/i)).toBeInTheDocument();
  });

  it('accumulates successive commands in the scrollback', async () => {
    renderTerminal();
    runCommand('cat /etc/passwd');
    await screen.findByText(/alice:hunter2/);
    runCommand('frobnicate');
    await screen.findByText(/command not found/i);

    expect(screen.getByText('alice@workstation> cat /etc/passwd')).toBeInTheDocument();
    expect(screen.getByText('alice@workstation> frobnicate')).toBeInTheDocument();
  });
});
