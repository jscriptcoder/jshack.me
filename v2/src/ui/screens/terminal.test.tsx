import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Terminal } from './terminal';
import { startGame } from '../state';
import { SEED_CONFIG } from '../seed';
import { CONNECTED_ESSID_KEY } from '../connectionPersistence';

/** Fresh terminal state per test — the module-singleton session + signals are
 *  rebuilt by `startGame`, which also clears the scrollback, so this both
 *  initialises the game and resets state between tests. Clearing the persisted
 *  WiFi connection first guarantees each test starts OFFLINE, so a prior test's
 *  nmcli connect can't leak an online wlan0 into the next. */
const renderTerminal = () => {
  localStorage.removeItem(CONNECTED_ESSID_KEY);
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

  it('streams the airdump scan into the scrollback once monitor mode is on', async () => {
    // End-to-end through the real UI seam: airmon flips monitor mode, then
    // airdump returns an ASYNC result whose lines `runInput` must stream into
    // the scrollback. Without the async branch the result is dropped and
    // nothing appears — so the header + summary tail prove the wiring.
    renderTerminal();
    runCommand('airmon start wlan0');
    await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));

    runCommand('airdump');
    expect(
      await screen.findByText((content) => content.includes('BSSID') && content.includes('ESSID')),
    ).toBeInTheDocument();
    // The scan paces rows with real timers, so allow it to drain to completion.
    expect(
      await screen.findByText(/^Scan complete — \d+ networks found$/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('Ctrl-C aborts a running aircrack before the key is revealed', async () => {
    // End-to-end abort wiring: the keyhandler calls abortRunning(), which aborts
    // the run's controller → rejects the in-flight env.sleep → the run catches
    // it, prints `^C`, and stops. The KEY FOUND reveal must never appear.
    // The shell runs ONE command at a time, so let the streaming scan finish
    // before the crack takes the foreground (it would otherwise queue behind it).
    renderTerminal();
    runCommand('airmon start wlan0');
    await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));
    runCommand('airdump');
    await screen.findByText((content) => content.includes('Scan complete'), {}, { timeout: 8000 });
    const bssidRow = screen.getAllByText((content) =>
      /^[0-9A-F]{2}(:[0-9A-F]{2}){5}\s+-\d+/.test(content),
    )[0]!;
    const bssid = bssidRow.textContent!.trim().split(/\s+/)[0]!;

    runCommand(`aircrack ${bssid}`);
    // Let the crack begin (the capture preamble streams before the first pause).
    await screen.findByText((content) => content.includes('Opening capture file'));
    fireEvent.keyDown(inputField(), { key: 'c', ctrlKey: true });

    expect(await screen.findByText('^C')).toBeInTheDocument();
    expect(screen.queryByText(/KEY FOUND/)).not.toBeInTheDocument();
  });

  it('cracks a WiFi AP, connects with nmcli, goes online, and stays online across a reload', async () => {
    // The whole arc, end-to-end through the real UI seam: monitor → scan →
    // crack (reveals the password) → nmcli connect (awaits the join seam, sets
    // wlan0's IP) → online. Then a fresh startGame (a reload) must rehydrate the
    // connection from the persisted ESSID alone. Drives the new wiring:
    // env.homeNetwork.join, setInterface→persist, and startGame→restore.
    renderTerminal();
    runCommand('airmon start wlan0');
    await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));

    runCommand('airdump');
    // A crackable AP is the only kind that is WPA2 AND strong (≥ -80) AND named
    // — noise APs each fail one of those. There may be several, so take the first.
    const crackableRow = /^([0-9A-F:]{17})\s+-\d+\s+\d+\s+WPA2\s+(.+)$/;
    const isCrackable = (content: string): boolean => {
      const match = crackableRow.exec(content.trim());
      if (match === null) return false;
      const power = Number(/\s(-\d+)\s/.exec(content.trim())?.[1]);
      return match[2] !== '<hidden>' && power >= -80;
    };
    const rows = await screen.findAllByText(
      (content) => isCrackable(content),
      {},
      { timeout: 4000 },
    );
    const parsed = crackableRow.exec(rows[0]!.textContent!.trim())!;
    const bssid = parsed[1]!.trim();
    const essid = parsed[2]!.trim();

    runCommand(`aircrack ${bssid}`);
    const keyRow = await screen.findByText(
      (content) => content.includes('KEY FOUND'),
      {},
      { timeout: 4000 },
    );
    const password = /KEY FOUND! \[ (.+) \]/.exec(keyRow.textContent!)![1]!.trim();

    // Monitor mode and an association are mutually exclusive, so leave monitor
    // mode before connecting (nmcli refuses otherwise).
    runCommand('airmon stop wlan0');
    await screen.findByText((content) => content.includes('monitor mode disabled on wlan0'));

    runCommand(`nmcli connect ${essid} ${password}`);
    const connectedRow = await screen.findByText(
      (content) => content.includes(`Connected to ${essid} — assigned`),
      {},
      { timeout: 4000 },
    );
    const assignedIp = /assigned (192\.168\.\d+\.\d+)/.exec(connectedRow.textContent!)![1]!;

    // Online proof: ifconfig now shows wlan0 carrying the assigned IP.
    runCommand('ifconfig');
    expect(
      await screen.findByText((content) => content.includes(`inet ${assignedIp}`)),
    ).toBeInTheDocument();

    // Reload: a fresh startGame rebuilds connectivity from cold + the persisted
    // ESSID. No re-crack — the IP is re-derived and the player is still online.
    startGame(SEED_CONFIG);
    runCommand('nmcli status');
    expect(
      await screen.findByText(`wlan0: connected to ${essid} (${assignedIp}/24)`),
    ).toBeInTheDocument();
    // The full arc runs real timers end-to-end (scan + crack + reload), so this
    // one test needs headroom beyond the 5s default.
  }, 15000);

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

  it('opens nano over the terminal and Ctrl-X returns to the prompt', async () => {
    // The editor is a Terminal-level overlay: `nano <file>` swaps the prompt for
    // the nano textarea (terminal input leaves the DOM), and Ctrl-X swaps back.
    renderTerminal();
    runCommand('nano /etc/passwd');

    const editorEl = await screen.findByRole('textbox', { name: /editor/i });
    expect(editorEl).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /terminal input/i })).not.toBeInTheDocument();

    fireEvent.keyDown(editorEl, { key: 'x', ctrlKey: true });

    expect(await screen.findByRole('textbox', { name: /terminal input/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /editor/i })).not.toBeInTheDocument();
  });
});
