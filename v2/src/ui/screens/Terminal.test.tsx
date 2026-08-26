import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Terminal } from './Terminal';
import {
  pendingPrompt,
  runInput,
  scrollback,
  setInput,
  setOverlayMode,
  startGame,
} from '../state';
import { SEED_CONFIG } from '../seed';
import { CONNECTED_ESSID_KEY } from '../connectionPersistence';
import { generateHomeLan } from '../../core/generation/generateHomeLan';
import { buildRemoteHostFs } from '../../core/generation/remoteHostFs';
import { readOpenPorts } from '../../core/services/pidfile';
import { SERVICE_CATALOG } from '../../core/services/serviceCatalog';
import { lanLeaseCacheIn } from '../../core/network/lanLeaseCache';
import { BINARY_STUB } from '../../core/generation/binaries';

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

/** The prompt is swapped out for the busy bar while a command runs, so it only
 *  returns once the shell is genuinely idle — which is a beat AFTER a streamed
 *  command's last output line paints. Await it (having first awaited that line,
 *  or this resolves against the prompt the command hasn't taken yet) before
 *  submitting the next command. */
const awaitPrompt = (timeout = 4000) =>
  screen.findByRole('textbox', { name: /terminal input/i }, { timeout });

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

  it('streams the airodump-ng scan into the scrollback once monitor mode is on', async () => {
    // End-to-end through the real UI seam: airmon-ng flips monitor mode, then
    // airodump-ng returns an ASYNC result whose lines `runInput` must stream into
    // the scrollback. Without the async branch the result is dropped and
    // nothing appears — so the header + summary tail prove the wiring.
    // Connecting now needs a server: the player's address is a LEASE the join
    // issues, and the client may not invent one. This stub is that server.
    const LEASED_IP = '192.168.42.7';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, local_ip: LEASED_IP }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    renderTerminal();
    runCommand('airmon-ng start wlan0');
    await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));

    runCommand('airodump-ng');
    expect(
      await screen.findByText((content) => content.includes('BSSID') && content.includes('ESSID')),
    ).toBeInTheDocument();
    // The scan paces rows with real timers, so allow it to drain to completion.
    expect(
      await screen.findByText(/^Scan complete — \d+ networks found$/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('Ctrl-C aborts a running aircrack-ng before the key is revealed', async () => {
    // End-to-end abort wiring: the keyhandler calls abortRunning(), which aborts
    // the run's controller → rejects the in-flight env.sleep → the run catches
    // it, prints `^C`, and stops. The KEY FOUND reveal must never appear.
    // The shell runs ONE command at a time, so let the streaming scan finish
    // before the crack takes the foreground (it would otherwise queue behind it).
    renderTerminal();
    runCommand('airmon-ng start wlan0');
    await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));
    runCommand('airodump-ng');
    await screen.findByText((content) => content.includes('Scan complete'), {}, { timeout: 8000 });
    await awaitPrompt();
    const bssidRow = screen.getAllByText((content) =>
      /^[0-9A-F]{2}(:[0-9A-F]{2}){5}\s+-\d+/.test(content),
    )[0]!;
    const bssid = bssidRow.textContent!.trim().split(/\s+/)[0]!;

    runCommand(`aircrack-ng ${bssid}`);
    // Let the crack begin (the capture preamble streams before the first pause).
    await screen.findByText((content) => content.includes('Opening capture file'));
    // The busy bar names the COMMAND, not the whole line — no bssid in it.
    const busyBar = screen.getByTestId('terminal-loading');
    expect(busyBar).toHaveTextContent('aircrack-ng...');
    expect(busyBar).not.toHaveTextContent(bssid);
    // The prompt is swapped for the busy spinner while the crack runs, so the
    // interrupt arrives at the document, not at the (unmounted) input.
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });

    expect(await screen.findByText('^C')).toBeInTheDocument();
    expect(screen.queryByText(/KEY FOUND/)).not.toBeInTheDocument();
  });

  describe('busy indicator', () => {
    it('swaps the prompt for a spinner naming the running command, then hands it back focused', async () => {
      // One streamed command, whole lifecycle: the shell must LOOK busy for as
      // long as it is busy (the scan paces its rows over real time), and the
      // player must be able to type again the moment it isn't — without clicking.
      renderTerminal();
      runCommand('airmon-ng start wlan0');
      await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));

      // Submitted with stray leading whitespace — the bar still names the command.
      runCommand('  airodump-ng');

      expect(await screen.findByTestId('terminal-loading')).toHaveTextContent('airodump-ng...');
      expect(screen.queryByLabelText(/terminal input/i)).not.toBeInTheDocument();

      // With no input to swallow them, stray keystrokes reach the window — only
      // Ctrl-C may interrupt, so typing ahead must not kill the scan.
      fireEvent.keyDown(document, { key: 'a' });
      fireEvent.keyDown(document, { key: 'v', ctrlKey: true });

      await screen.findByText(/^Scan complete/, {}, { timeout: 8000 });
      const field = await awaitPrompt();

      expect(screen.queryByTestId('terminal-loading')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(field);
    });

    it('keeps the prompt typeable while a running command waits on a password', async () => {
      // `su` is still running here — but it is blocked on the player, so the
      // spinner must stand aside and let the password be typed.
      renderTerminal();
      runCommand('su');
      expect(await screen.findByText('Password:')).toBeInTheDocument();

      expect(screen.queryByTestId('terminal-loading')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/terminal input/i)).toBeInTheDocument();
    });

    it('leaves no spinner behind when a prompt-blocked command is cancelled', async () => {
      renderTerminal();
      runCommand('su');
      await screen.findByText('Password:');

      fireEvent.keyDown(screen.getByLabelText(/terminal input/i), { key: 'c', ctrlKey: true });

      expect(await screen.findByRole('textbox', { name: /terminal input/i })).toBeInTheDocument();
      expect(screen.queryByTestId('terminal-loading')).not.toBeInTheDocument();
    });
  });

  it('cracks a WiFi AP, connects with nmcli, goes online, and stays online across a reload', async () => {
    // The whole arc, end-to-end through the real UI seam: monitor → scan →
    // crack (reveals the password) → nmcli connect (awaits the join seam, sets
    // wlan0's IP) → online. Then a fresh startGame (a reload) must rehydrate the
    // connection from the persisted ESSID alone. Drives the new wiring:
    // env.homeNetwork.join, setInterface→persist, and startGame→restore.
    renderTerminal();
    runCommand('airmon-ng start wlan0');
    await screen.findByText((content) => content.includes('monitor mode enabled on wlan0'));

    runCommand('airodump-ng');
    // A crackable AP is the only kind that is WPA2 AND strong (≥ -80) AND named
    // — noise APs each fail one of those. There may be several, so take the first.
    const crackableRow = /^([0-9A-F:]{17})\s+-\d+\s+\d+\s+WPA2\s+(.+)$/;
    const isCrackable = (content: string): boolean => {
      const match = crackableRow.exec(content.trim());
      if (match === null) return false;
      const power = Number(/\s(-\d+)\s/.exec(content.trim())?.[1]);
      return match[2] !== '<hidden>' && power >= -80;
    };
    // Let the scan run to completion — the busy bar holds the prompt until it
    // does, and every row is on screen by then.
    await screen.findByText(/^Scan complete/, {}, { timeout: 4000 });
    await awaitPrompt();
    const rows = screen.getAllByText((content) => isCrackable(content));
    const parsed = crackableRow.exec(rows[0]!.textContent!.trim())!;
    const bssid = parsed[1]!.trim();
    const essid = parsed[2]!.trim();

    runCommand(`aircrack-ng ${bssid}`);
    const keyRow = await screen.findByText(
      (content) => content.includes('KEY FOUND'),
      {},
      { timeout: 4000 },
    );
    const password = /KEY FOUND! \[ (.+) \]/.exec(keyRow.textContent!)![1]!.trim();
    await awaitPrompt();

    // Monitor mode and an association are mutually exclusive, so leave monitor
    // mode before connecting (nmcli refuses otherwise).
    runCommand('airmon-ng stop wlan0');
    await screen.findByText((content) => content.includes('monitor mode disabled on wlan0'));

    runCommand(`nmcli connect ${essid} ${password}`);
    const connectedRow = await screen.findByText(
      (content) => content.includes(`Connected to ${essid} — assigned`),
      {},
      { timeout: 4000 },
    );
    const assignedIp = /assigned (192\.168\.\d+\.\d+)/.exec(connectedRow.textContent!)![1]!;
    await awaitPrompt();

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
      typeInput('c'); // matches `cat`, `cd` and `curl`
      pressTab();

      // Common prefix is just `c`, so the input is unchanged; the candidates
      // are printed on one scrollback line.
      expect(inputField()).toHaveValue('c');
      expect(await screen.findByText('cat, cd, curl')).toBeInTheDocument();
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

  describe('Prompt focus', () => {
    it('focuses the prompt input on mount so the player can type immediately', () => {
      renderTerminal();

      expect(document.activeElement).toBe(inputField());
    });

    it('snaps focus back to the prompt on a plain click in the terminal', () => {
      renderTerminal();
      const field = inputField();
      field.blur();
      expect(document.activeElement).not.toBe(field);

      // A plain click leaves no text selection, so focus returns to the prompt.
      fireEvent.click(screen.getByTestId('terminal-banner'));

      expect(document.activeElement).toBe(field);
    });

    it('does not steal focus while output text is selected, so it stays copyable', () => {
      renderTerminal();
      const field = inputField();
      field.blur();
      // A live, non-collapsed selection means the player is highlighting output
      // to copy it — clicking must NOT pull focus to the prompt (which would clear
      // the highlight and make Ctrl-C copy the empty prompt instead).
      const getSelection = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue({ isCollapsed: false } as Selection);

      fireEvent.click(screen.getByTestId('terminal-banner'));

      expect(document.activeElement).not.toBe(field);
      getSelection.mockRestore();
    });

    it('returns focus to the prompt after exiting nano', async () => {
      renderTerminal();
      runCommand('nano /etc/passwd');
      const editorEl = await screen.findByRole('textbox', { name: /editor/i });

      fireEvent.keyDown(editorEl, { key: 'x', ctrlKey: true });

      const field = await screen.findByRole('textbox', { name: /terminal input/i });
      expect(document.activeElement).toBe(field);
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

describe('Terminal full-screen apps', () => {
  it('hands the whole screen to the browser, then gives it back with the scrollback intact', async () => {
    renderTerminal();
    runCommand('pwd');
    await screen.findByText('/home/alice');

    setOverlayMode({ kind: 'lynx', url: 'http://192.168.1.5/', content: '<h1>a page</h1>' });

    expect(await screen.findByText('a page')).toBeInTheDocument();
    // The terminal is GONE, not merely covered — the prompt cannot take a
    // keystroke meant for the page on screen.
    expect(screen.queryByRole('textbox', { name: /terminal input/i })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('main'), { key: 'q' });

    expect(await screen.findByRole('textbox', { name: /terminal input/i })).toBeInTheDocument();
    expect(screen.getByText('/home/alice')).toBeInTheDocument();
    expect(screen.queryByText('a page')).not.toBeInTheDocument();
  });

  it('puts the cursor back in the prompt when the browser closes', async () => {
    renderTerminal();
    setOverlayMode({ kind: 'lynx', url: 'http://192.168.1.5/', content: '<p>read me</p>' });
    await screen.findByText('read me');

    fireEvent.keyDown(screen.getByRole('main'), { key: 'Escape' });

    expect(await screen.findByRole('textbox', { name: /terminal input/i })).toBe(
      document.activeElement,
    );
  });
});

/**
 * A sub-shell REPLACES the prompt rather than decorating it. Everything else about
 * the `mysql>` prompt is settled in the state layer, but not this: the player being
 * "left at mysql>" is a thing they SEE, and a terminal that answered SQL while still
 * showing `tester@box:/home/tester$` would pass every assertion one layer down.
 */
describe('a sub-shell prompt', () => {
  const ESSID = 'BEAN-THERE-WIFI';
  const LAN = generateHomeLan(ESSID);
  const DATABASE_HOST = LAN.hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some(
        (open) => open.service === SERVICE_CATALOG.mysql.service,
      ),
  );
  if (DATABASE_HOST === undefined) throw new Error(`need a database host on ${ESSID}`);

  it('reads mysql> once a database opens, and hands the shell prompt back on quit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        if (fields.action === 'mysqlConnect') {
          // The box names itself: a 200 without one is not an open door, because the
          // greeting has nothing to greet.
          return new Response(JSON.stringify({ ok: true, hostname: 'db-11' }), { status: 200 });
        }
        // The client is apt-gated, so the box has to already carry it.
        return new Response(
          JSON.stringify({
            sessions: [],
            patches: [
              {
                path: '/usr/bin/mysql',
                content: BINARY_STUB,
                owner: 'root',
                permissions: {
                  read: ['root', 'user', 'guest'],
                  write: ['root'],
                  execute: ['root', 'user', 'guest'],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    localStorage.setItem(CONNECTED_ESSID_KEY, ESSID);
    lanLeaseCacheIn(localStorage).remember(ESSID, `${LAN.subnet}.77`);
    startGame(SEED_CONFIG);
    render(() => <Terminal />);
    // The boot journal fetch is in flight; the client only exists once it lands.
    // Driven through the state seam rather than the DOM, because the busy bar takes
    // the input field away mid-command and this warm-up is not what is under test.
    await vi.waitFor(async () => {
      setInput('ls /usr/bin');
      await runInput();
      expect(scrollback().some((entry) => entry.content.includes('mysql'))).toBe(true);
    });

    runCommand(`mysql ${DATABASE_HOST.ip}`);
    // Answered through the FIELD, because a credential prompt keeps the input
    // typeable and that is the path the player takes. Waited on by which prompt is
    // pending rather than by the field appearing: the field never went away, so
    // finding it proves nothing about whose question it is holding.
    await vi.waitFor(() => expect(pendingPrompt()?.masked).toBe(false));
    const account = await awaitPrompt();
    fireEvent.input(account, { target: { value: 'readonly' } });
    fireEvent.keyDown(account, { key: 'Enter' });
    await vi.waitFor(() => expect(pendingPrompt()?.masked).toBe(true));
    // By label, not by role: a masked prompt renders `type="password"`, which has no
    // implicit textbox role at all — the field the player types the password into is
    // invisible to every other lookup in this file.
    const password = screen.getByLabelText(/terminal input/i);
    fireEvent.input(password, { target: { value: 'hunter2' } });
    fireEvent.keyDown(password, { key: 'Enter' });

    await screen.findByText('Welcome to the MySQL monitor. Type help for commands.');
    // The shell's own prompt names a machine the player is no longer typing at —
    // and one this door reaches no files on. It must be GONE, not merely joined.
    // Exact, including the trailing space: the prompt renders `whitespace-pre`, so
    // the gap before the cursor is a rendered character rather than layout, and the
    // default text matcher collapses exactly the difference that would be visible.
    expect((await screen.findByText('mysql>')).textContent).toBe('mysql> ');
    expect(screen.queryByText('alice@workstation:/home/alice$')).not.toBeInTheDocument();

    runCommand('quit');

    await screen.findByText('Bye');
    expect(await screen.findByText('alice@workstation:/home/alice$')).toBeInTheDocument();
  });
});
