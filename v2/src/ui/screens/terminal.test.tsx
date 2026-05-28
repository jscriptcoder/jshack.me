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

    expect(
      await screen.findByText('alice@workstation:/home/alice$ cat /etc/passwd'),
    ).toBeInTheDocument();
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

    expect(
      screen.getByText('alice@workstation:/home/alice$ cat /etc/passwd'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('alice@workstation:/home/alice$ frobnicate'),
    ).toBeInTheDocument();
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

  it('treats tokens after `--` as positional, even if they look like flags', () => {
    // `cat -- -n` — the `--` says "stop option parsing"; `-n` becomes a
    // literal filename. The seed FS has no file named `-n`, so cat reports
    // not-found. Without the sentinel, the parser would either route `-n`
    // as a flag (no numbered passwd here) or reject `-X`-like tokens.
    renderTerminal();
    runCommand('cat -- -n');

    return expect(
      screen.findByText('cat: -n: No such file or directory'),
    ).resolves.toBeInTheDocument();
  });

  it('prints the working directory when `pwd` runs', async () => {
    renderTerminal();
    runCommand('pwd');

    expect(await screen.findByText('/home/alice')).toBeInTheDocument();
  });

  it('changes the cwd; subsequent pwd reflects the new directory', async () => {
    renderTerminal();
    runCommand('cd /etc');
    // cd is silent — no output line — so we directly issue pwd next.
    runCommand('pwd');

    expect(await screen.findByText('/etc')).toBeInTheDocument();
    // Next prompt echo also reflects the new cwd.
    expect(await screen.findByText('alice@workstation:/etc$ pwd')).toBeInTheDocument();
  });

  it('failed cd leaves the cwd unchanged', async () => {
    renderTerminal();
    runCommand('cd /nope');
    runCommand('pwd');

    expect(
      await screen.findByText('cd: /nope: No such file or directory'),
    ).toBeInTheDocument();
    expect(await screen.findByText('/home/alice')).toBeInTheDocument();
    // The post-failure prompt still shows the original cwd.
    expect(
      screen.getByText('alice@workstation:/home/alice$ pwd'),
    ).toBeInTheDocument();
  });

  it('lists directory contents with `ls`', async () => {
    // Seed FS: /etc contains `motd` and `passwd`. Both are world-readable
    // ENTRIES of /etc (whose perms allow read); /etc/passwd's content
    // is still gated separately. `ls` only needs to read the directory.
    renderTerminal();
    runCommand('ls /etc');

    expect(await screen.findByText('motd')).toBeInTheDocument();
    expect(await screen.findByText('passwd')).toBeInTheDocument();
  });

  it('finds matching lines with `grep PATTERN file`', async () => {
    // Seed FS: /etc/passwd contains alice's row. grep is case-insensitive
    // by default; `Alice` matches the lowercase `alice` line.
    renderTerminal();
    runCommand('grep Alice /etc/passwd');

    expect(await screen.findByText(/alice:hunter2/)).toBeInTheDocument();
  });

  it('`grep PATTERN /etc` recursively walks the directory and prefixes filepaths', async () => {
    // Seed /etc has motd ("Welcome to JSHACK.ME...") and passwd. `Welcome`
    // only appears in motd. The recursive walk emits `/etc/motd:<line>`.
    renderTerminal();
    runCommand('grep Welcome /etc');

    expect(
      await screen.findByText(/^\/etc\/motd:Welcome to JSHACK\.ME/),
    ).toBeInTheDocument();
  });

  it('`ls -la` (stacked) shows hidden entries in long format', async () => {
    // End-to-end demo of the stacking infrastructure: `-la` is parsed as
    // `-l -a` and ls renders both behaviors. /etc has perms (drwxrwxrwx
    // by tier-truthful mapping under TRAVERSABLE_DIR) so `.` is visible
    // here. We just assert ONE row contains the long-format perms-prefix
    // and a passwd entry — full output is locked down in unit tests.
    renderTerminal();
    runCommand('ls -la /etc');

    // -l prefixes each entry with the perms+owner+size columns; under
    // the tier-truthful mapping, /etc/passwd has perms read:root+user,
    // write:root, execute:root → `-rwxr-----`.
    expect(await screen.findByText(/^-rwxr----- root \d+ passwd$/)).toBeInTheDocument();
    // -a adds the synthetic `.` row. /etc's TRAVERSABLE_DIR perms map to
    // root rwx, user r-x, guest r-x → `drwxr-xr-x` under tier-truthful.
    expect(await screen.findByText(/^drwxr-xr-x root 4096 \.$/)).toBeInTheDocument();
  });
});
