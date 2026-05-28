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

  it('numbers each line when -n is passed', async () => {
    // /etc/passwd starts root:r00tpw on line 1, alice:hunter2 on line 2 —
    // asserting BOTH catches "counter doesn't increment" mutants.
    renderTerminal();
    runCommand('cat -n /etc/passwd');

    expect(await screen.findByText(/^1 root:r00tpw/)).toBeInTheDocument();
    expect(await screen.findByText(/^2 alice:hunter2/)).toBeInTheDocument();
  });

  it('shows an "unrecognized option" error for an unknown flag', async () => {
    renderTerminal();
    runCommand('cat -xyz /etc/passwd');

    expect(await screen.findByText('cat: unrecognized option: -xyz')).toBeInTheDocument();
  });

  it('limits head output to N lines when -n N is passed', async () => {
    // /etc/passwd has root on line 1 and alice on line 2; -n 1 must show
    // root and exclude alice — proves bindFlags is plumbing string-typed
    // values through to head end-to-end.
    renderTerminal();
    runCommand('head -n 1 /etc/passwd');

    expect(await screen.findByText(/root:r00tpw/)).toBeInTheDocument();
    expect(screen.queryByText(/alice:hunter2/)).not.toBeInTheDocument();
  });

  it('passes a quoted multi-word string through to echo as one token', async () => {
    renderTerminal();
    runCommand('echo "hello world"');

    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('shows a syntax error for an unterminated quote', async () => {
    renderTerminal();
    runCommand('echo "unterminated');

    expect(
      await screen.findByText('bash: syntax error: unexpected end of file'),
    ).toBeInTheDocument();
  });

  it('expands `cat -nE` into both -n and -E, numbering AND suffixing lines', async () => {
    // /etc/passwd line 1 is `root:r00tpw:0:0:root:/root:/bin/bash`.
    // After cat -nE it should be `     1\troot:...:/bin/bash$`.
    // testing-library normalisation collapses leading whitespace to one space.
    renderTerminal();
    runCommand('cat -nE /etc/passwd');

    expect(await screen.findByText(/^1 root:r00tpw.*\$$/)).toBeInTheDocument();
  });
});
