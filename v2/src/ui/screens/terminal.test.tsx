import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Terminal } from './terminal';
import { startGame } from '../state';
import { SEED_CONFIG } from '../seed';

/** Fresh terminal state per test — the module-singleton session + signals are
 *  rebuilt by `startGame`, which also clears the scrollback, so this both
 *  initialises the game and resets state between tests. */
const renderTerminal = () => {
  startGame(SEED_CONFIG);
  return render(() => <Terminal />);
};

const runCommand = (value: string) => {
  const field = screen.getByRole('textbox', { name: /terminal input/i });
  fireEvent.input(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
};

const inputField = () => screen.getByRole('textbox', { name: /terminal input/i });

describe('Terminal', () => {
  it('shows the JSHACK.ME banner with the current version and help hint on boot', () => {
    renderTerminal();

    const banner = screen.getByTestId('terminal-banner');
    expect(banner).toHaveTextContent(`v${__APP_VERSION__}`);
    expect(banner).toHaveTextContent('Type help for available commands');
  });

  it('echoes the typed command above its output', async () => {
    renderTerminal();
    runCommand('cat /etc/passwd');

    expect(
      await screen.findByText('alice@workstation:/home/alice$ cat /etc/passwd'),
    ).toBeInTheDocument();
    expect(await screen.findByText(/^alice::1000:1000:alice/)).toBeInTheDocument();
  });

  it('shows "command not found" for an unknown command', async () => {
    renderTerminal();
    runCommand('frobnicate');

    expect(await screen.findByText(/command not found/i)).toBeInTheDocument();
  });

  it('accumulates successive commands in the scrollback', async () => {
    renderTerminal();
    runCommand('cat /etc/passwd');
    await screen.findByText(/^alice::1000:1000:alice/);
    runCommand('frobnicate');
    await screen.findByText(/command not found/i);

    expect(screen.getByText('alice@workstation:/home/alice$ cat /etc/passwd')).toBeInTheDocument();
    expect(screen.getByText('alice@workstation:/home/alice$ frobnicate')).toBeInTheDocument();
  });

  it('numbers each line when -n is passed', async () => {
    // /etc/passwd is root (md5'd hunter2) on line 1, alice (empty hash) on
    // line 2 — asserting BOTH catches "counter doesn't increment" mutants.
    renderTerminal();
    runCommand('cat -n /etc/passwd');

    expect(await screen.findByText(/^1 root:2ab96390/)).toBeInTheDocument();
    expect(await screen.findByText(/^2 alice::1000/)).toBeInTheDocument();
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

    expect(await screen.findByText('cd: /nope: No such file or directory')).toBeInTheDocument();
    expect(await screen.findByText('/home/alice')).toBeInTheDocument();
    // The post-failure prompt still shows the original cwd.
    expect(screen.getByText('alice@workstation:/home/alice$ pwd')).toBeInTheDocument();
  });

  it('lists directory contents with `ls`', async () => {
    // Seed FS root is the generated minimal skeleton: etc, home, root, tmp.
    // `ls` reads the directory and lists its entries.
    renderTerminal();
    runCommand('ls /');

    expect(await screen.findByText('etc')).toBeInTheDocument();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(await screen.findByText('root')).toBeInTheDocument();
    expect(await screen.findByText('tmp')).toBeInTheDocument();
  });

  it('finds matching lines with `grep PATTERN file`', async () => {
    // Seed FS: /etc/passwd contains alice's row (empty hash — the player can
    // always exit() back). grep is case-insensitive; `Alice` matches `alice`.
    renderTerminal();
    runCommand('grep Alice /etc/passwd');

    expect(await screen.findByText(/^alice::1000:1000:alice:\/home\/alice/)).toBeInTheDocument();
  });

  it('`grep PATTERN /etc` recursively walks the directory and prefixes filepaths', async () => {
    // /etc/passwd is the only file in the minimal /etc. Its alice row matches,
    // and the recursive walk emits `/etc/passwd:<line>`.
    renderTerminal();
    runCommand('grep alice /etc');

    expect(await screen.findByText(/^\/etc\/passwd:alice::1000/)).toBeInTheDocument();
  });

  it('`grep -l root /etc` emits matching filepaths only, no `:line` content', async () => {
    // Seed /etc/passwd has the root row. -l mode emits just the
    // filepath when the file matched — no `:` and no line content.
    renderTerminal();
    runCommand('grep -l root /etc');

    expect(await screen.findByText('/etc/passwd')).toBeInTheDocument();
  });

  it('pipes one command into another (`cat /etc/passwd | grep root`)', async () => {
    // End-to-end through the real UI seam: the DOM input runs through
    // `runInput` → `runCommandLine`, threading cat's stdout into grep's
    // stdin. Only the root row should survive the filter.
    renderTerminal();
    runCommand('cat /etc/passwd | grep root');

    // root password is md5('hunter2'); the player (alice) row has no 'root'.
    expect(
      await screen.findByText(/^root:2ab96390c7dbe3439de74d0c9b0b1767:0:0:root:\/root/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^alice:/)).not.toBeInTheDocument();
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

  it('recalls the previous command into the input on ArrowUp', async () => {
    renderTerminal();
    runCommand('pwd');
    await screen.findByText('/home/alice');

    fireEvent.keyDown(inputField(), { key: 'ArrowUp' });

    expect(inputField()).toHaveValue('pwd');
  });

  it('walks back to an older command with successive ArrowUp presses', async () => {
    renderTerminal();
    runCommand('pwd');
    await screen.findByText('/home/alice');
    runCommand('ls /etc');
    await screen.findByText('passwd');

    fireEvent.keyDown(inputField(), { key: 'ArrowUp' });
    expect(inputField()).toHaveValue('ls /etc');
    fireEvent.keyDown(inputField(), { key: 'ArrowUp' });
    expect(inputField()).toHaveValue('pwd');
  });

  it('restores the half-typed draft when arrowing back down past the newest command', async () => {
    renderTerminal();
    runCommand('pwd');
    await screen.findByText('/home/alice');

    // Start a fresh line, recall history, then come back down to it.
    fireEvent.input(inputField(), { target: { value: 'echo draft' } });
    fireEvent.keyDown(inputField(), { key: 'ArrowUp' });
    expect(inputField()).toHaveValue('pwd');

    fireEvent.keyDown(inputField(), { key: 'ArrowDown' });
    expect(inputField()).toHaveValue('echo draft');
  });

  it('does not record blank submissions in the recallable history', async () => {
    renderTerminal();
    runCommand('pwd');
    await screen.findByText('/home/alice');
    runCommand('   ');

    // The only recallable entry is the real command, not the whitespace line.
    fireEvent.keyDown(inputField(), { key: 'ArrowUp' });
    expect(inputField()).toHaveValue('pwd');
    fireEvent.keyDown(inputField(), { key: 'ArrowUp' });
    expect(inputField()).toHaveValue('pwd');
  });

  describe('Tab completion', () => {
    const typeInput = (value: string) => fireEvent.input(inputField(), { target: { value } });
    const pressTab = () => fireEvent.keyDown(inputField(), { key: 'Tab' });

    it('completes a unique command prefix and appends a space', () => {
      renderTerminal();
      typeInput('hel');
      pressTab();

      expect(inputField()).toHaveValue('help ');
      // A unique completion must not also dump a candidate list into the scrollback.
      expect(screen.queryByText('help')).not.toBeInTheDocument();
    });

    it('decorates a completed directory with a trailing slash', () => {
      // Seed root has the `etc` directory; `/et` uniquely completes to it and
      // gets a trailing slash (no space) so the user can keep typing a path.
      renderTerminal();
      typeInput('cd /et');
      pressTab();

      expect(inputField()).toHaveValue('cd /etc/');
    });

    it('lists candidates when several commands match the prefix', async () => {
      renderTerminal();
      typeInput('c'); // matches `cat` and `cd`
      pressTab();

      // Common prefix is just `c`, so the input is unchanged; the candidates
      // are printed on one scrollback line.
      expect(inputField()).toHaveValue('c');
      expect(await screen.findByText('cat, cd')).toBeInTheDocument();
    });

    it('completes a path argument against the current filesystem', () => {
      // Seed /etc has `passwd`; `pa` uniquely completes to passwd.
      renderTerminal();
      typeInput('cat /etc/pa');
      pressTab();

      expect(inputField()).toHaveValue('cat /etc/passwd');
    });

    it('completes a unique flag from the command flag spec', () => {
      // cat declares only `-n`.
      renderTerminal();
      typeInput('cat -');
      pressTab();

      expect(inputField()).toHaveValue('cat -n ');
    });

    it('lists flags when several match', async () => {
      // ls declares `-a` and `-l`; common prefix is `-`, so the input is
      // unchanged and both are listed.
      renderTerminal();
      typeInput('ls -');
      pressTab();

      expect(inputField()).toHaveValue('ls -');
      expect(await screen.findByText('-a, -l')).toBeInTheDocument();
    });

    it('is a no-op when nothing matches', () => {
      renderTerminal();
      typeInput('zzz');
      pressTab();

      expect(inputField()).toHaveValue('zzz');
    });
  });
});
