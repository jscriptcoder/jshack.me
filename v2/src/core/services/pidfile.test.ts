import { describe, expect, it } from 'vitest';
import { SERVICE_CATALOG } from './serviceCatalog';
import {
  formatListenerContent,
  formatPidfileContent,
  listenerPid,
  listenerPidfilePath,
  parsePidfilePort,
  pidfilePath,
  readOpenPorts,
  readRunningProcesses,
  serviceByPidfileName,
} from './pidfile';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import type { Directory } from '../filesystem/types';
import { buildEntry, formatDpkgStatus } from '../packages/dpkgStatus';
import { exploitOutcome } from '../cve/exploitEffect';
import { asMachineId } from '../types';

const ssh = SERVICE_CATALOG.ssh;

/** A `/var/run` holding the given pidfiles, basename → content. Root-owned, as a
 *  real one is. */
const varRun = (pidfiles: Readonly<Record<string, string>>) =>
  buildDirectory({
    var: buildDirectory({
      run: buildDirectory(
        Object.fromEntries(
          Object.entries(pidfiles).map(([name, content]) => [
            name,
            buildFile(content, { owner: 'root' }),
          ]),
        ),
      ),
    }),
  });

describe('service pidfile format', () => {
  it('writes the canonical <daemon>:port=<n> line for a running service', () => {
    expect(formatPidfileContent(ssh, 22)).toBe('sshd:port=22');
  });

  it('writes a non-default port into the line', () => {
    expect(formatPidfileContent(ssh, 2222)).toBe('sshd:port=2222');
  });

  it('round-trips the port through format then parse', () => {
    expect(parsePidfilePort(formatPidfileContent(ssh, 22))).toBe(22);
    expect(parsePidfilePort(formatPidfileContent(ssh, 8022))).toBe(8022);
  });

  it('returns null when the content is not the canonical <daemon>:port=<n> shape', () => {
    expect(parsePidfilePort('')).toBeNull();
    expect(parsePidfilePort('sshd')).toBeNull();
    expect(parsePidfilePort('sshd:port=')).toBeNull();
    expect(parsePidfilePort('sshd:port=abc')).toBeNull();
    expect(parsePidfilePort('sshd:port=22 extra')).toBeNull();
    // the WHOLE line must be the canonical shape — leading junk is rejected too.
    expect(parsePidfilePort('garbage sshd:port=22')).toBeNull();
  });

  it('resolves the pidfile path under /var/run', () => {
    expect(pidfilePath(ssh)).toBe('/var/run/sshd.pid');
  });

  it('maps a /var/run pidfile name back to its service spec, and unknown names to undefined', () => {
    expect(serviceByPidfileName('sshd.pid')).toBe(ssh);
    expect(serviceByPidfileName('nginx.pid')).toBe(SERVICE_CATALOG.http);
    expect(serviceByPidfileName('nonesuch.pid')).toBeUndefined();
  });
});

/**
 * A listener is the other kind of thing a box can be running.
 *
 * A service is a UNIT: the world knows its name, its account and its default
 * port before anyone starts it, so a pidfile need only say where it is. A
 * listener is a PROCESS somebody left behind — the world knows nothing about it
 * until it exists, so its pidfile has to carry who planted it and at what tier.
 * That difference is why the reader returns a union rather than one row shape
 * with fields that are blank half the time.
 */
describe('a listener somebody planted', () => {
  it('records the port, the account that planted it, and the tier that account holds', () => {
    expect(formatListenerContent({ port: 4444, user: 'alice', userType: 'user' })).toBe(
      'nc:port=4444,user=alice,userType=user',
    );
  });

  it('lives at /var/run/nc-<port>.pid, so its name alone says which door it is holding', () => {
    expect(listenerPidfilePath(4444)).toBe('/var/run/nc-4444.pid');
  });

  it('reads back as a listener carrying everything its planter wrote', () => {
    const running = readRunningProcesses(
      varRun({ 'nc-4444.pid': formatListenerContent({ port: 4444, user: 'alice', userType: 'user' }) }),
    );

    expect(running).toEqual([{ kind: 'listener', port: 4444, user: 'alice', userType: 'user' }]);
  });

  it('sits alongside the services on the same box, each read as what it is', () => {
    // One pass over `/var/run`, two kinds out. A box running sshd with a backdoor
    // on it must report both, or the survey that is supposed to expose the
    // backdoor hides it behind the daemon that was there first.
    const running = readRunningProcesses(
      varRun({
        'sshd.pid': 'sshd:port=22',
        'nc-4444.pid': formatListenerContent({ port: 4444, user: 'alice', userType: 'user' }),
      }),
    );

    expect(running).toEqual([
      { kind: 'service', spec: ssh, port: 22 },
      { kind: 'listener', port: 4444, user: 'alice', userType: 'user' },
    ]);
  });

  it('is skipped when its line is not the shape a planter writes', () => {
    // Unlike a service, there is no default to fall back to: the world knows
    // nothing about a listener except what its own line says, so a line that
    // says nothing describes no process. A garbled service line still names a
    // daemon the catalog can answer for; a garbled listener line names nobody.
    const malformed = [
      'nc:port=4444',
      'nc:port=4444,user=alice',
      'nc:port=4444,user=alice,userType=wizard',
      'nc:port=abc,user=alice,userType=user',
      'nc:port=4444,user=,userType=user',
      'garbage nc:port=4444,user=alice,userType=user',
      // Trailing junk past the third field. The pidfile is root-writable on a box a
      // player owns, so this is a line somebody can really type — and a parser that read
      // the fields it knew and ignored the rest would admit a door the format never
      // promised to describe.
      'nc:port=4444,user=mallory,userType=root,tier=wizard',
    ];

    for (const content of malformed) {
      expect(readRunningProcesses(varRun({ 'nc-4444.pid': content }))).toEqual([]);
    }
  });

  it('admits a listener planted at guest tier, the least a door can be worth', () => {
    // All three tiers have to survive validation, not just the two an intruder wants.
    // A guest backdoor is the quiet one — it opens a shell that can look and not touch —
    // and a validator that dropped it would silently close a door the game hands out.
    const guestDoor = formatListenerContent({ port: 4444, user: 'nobody', userType: 'guest' });

    expect(readRunningProcesses(varRun({ 'nc-4444.pid': guestDoor }))).toEqual([
      { kind: 'listener', port: 4444, user: 'nobody', userType: 'guest' },
    ]);
  });

  it('is not a listener when the name is a directory', () => {
    // `mkdir /var/run/nc-4444.pid` is something a root player can really do, and
    // reading it as a backdoor would let anyone advertise a door that opens onto
    // nothing.
    const tree = buildDirectory({
      var: buildDirectory({ run: buildDirectory({ 'nc-4444.pid': buildDirectory({}) }) }),
    });

    expect(readRunningProcesses(tree)).toEqual([]);
  });

  it('shows up to a port scan as an open port the world cannot name', () => {
    // The whole nmap story: a scan renders whatever this projects, so a listener
    // needs no scanner change to appear. `unknown` is the honest answer — a port
    // is open and nothing in the catalog claims it, which is the question that
    // makes connecting to it worth a player's time.
    const ports = readOpenPorts(
      varRun({
        'sshd.pid': 'sshd:port=22',
        'nc-4444.pid': formatListenerContent({ port: 4444, user: 'alice', userType: 'user' }),
      }),
    );

    expect(ports).toEqual([
      { port: 22, service: 'ssh' },
      { port: 4444, service: 'unknown' },
    ]);
  });
});

/**
 * The PID is DERIVED, never stored: a function of the box and the port, so it is
 * the same every time anyone asks. Legacy renumbered on every read, which meant
 * the number a player wrote down to `kill` could belong to something else by the
 * time they typed it.
 */
describe('the PID a listener answers to', () => {
  const BOX = asMachineId('ws-alice');

  it('is the same number every time it is asked for', () => {
    expect(listenerPid(BOX, 4444)).toBe(listenerPid(BOX, 4444));
  });

  it('looks like a PID a real box would hand out', () => {
    const pid = listenerPid(BOX, 4444);

    expect(Number.isInteger(pid)).toBe(true);
    expect(pid).toBeGreaterThanOrEqual(100);
    expect(pid).toBeLessThanOrEqual(32767);
  });

  it('differs between two listeners on one box', () => {
    expect(listenerPid(BOX, 4444)).not.toBe(listenerPid(BOX, 4445));
  });

  it('differs between two boxes holding the same port', () => {
    // Seeded on the machine as well as the port, so an intruder who plants 4444
    // on six boxes does not find one number killing all of them.
    expect(listenerPid(BOX, 4444)).not.toBe(listenerPid(asMachineId('ws-bob'), 4444));
  });
});

/**
 * What VERSION a scanned port is running — the fact a CVE will be keyed on, and the
 * one `nmap -sV` renders.
 *
 * It is resolved here, beside the port itself, because this is one of only two places
 * an open port is ever constructed and it already holds the tree the manifest lives on.
 * A port's version and its service name come from the same box in the same read, so the
 * two can never describe different software.
 *
 * The manifest is the authority, never the version table: `apt upgrade` will move a box
 * off its starting version, and a scan that answered from the table would keep reporting
 * the vulnerable one long after the defender had patched it.
 */
/** A box running `pidfiles`, carrying `packages` in its manifest. */
const boxRunning = (
  pidfiles: Readonly<Record<string, string>>,
  packages: Readonly<Record<string, string>> = {},
) =>
  buildDirectory({
    var: buildDirectory({
      run: buildDirectory(
        Object.fromEntries(
          Object.entries(pidfiles).map(([name, content]) => [
            name,
            buildFile(content, { owner: 'root' }),
          ]),
        ),
      ),
      lib: buildDirectory({
        dpkg: buildDirectory({
          status: buildFile(
            formatDpkgStatus(
              Object.entries(packages).map(([pkg, version]) => buildEntry(pkg, version)),
            ),
            { owner: 'root' },
          ),
        }),
      }),
    }),
  });

describe('the version a scanned port advertises', () => {
  it('names the version of the package behind the daemon that is running', () => {
    const ports = boxRunning({ 'sshd.pid': 'sshd:port=22' }, { 'openssh-server': '9.7.0' });

    expect(readOpenPorts(ports)).toEqual([{ port: 22, service: 'ssh', version: 'OpenSSH 9.7.0' }]);
  });

  it('reports what the MANIFEST holds, not what the package started life at', () => {
    // The whole point of reading the file rather than the table. Once `apt upgrade`
    // exists, a box that has patched must stop advertising the version it shipped with
    // — otherwise the defence is invisible and the attacker keeps aiming at a hole that
    // is already closed.
    const patched = boxRunning({ 'sshd.pid': 'sshd:port=22' }, { 'openssh-server': '9.9.9' });

    expect(readOpenPorts(patched)[0]?.version).toBe('OpenSSH 9.9.9');
  });

  it('wears the product own name, which is not the package name or the service name', () => {
    // Three names for one door and each has its job: `nginx` is what apt installs,
    // `http` is what the scan SERVICE column prints, and `nginx/1.26.0` is what the
    // daemon calls itself. A scan that printed the package name would be inventing a
    // banner no real product writes.
    const ports = readOpenPorts(boxRunning({ 'nginx.pid': 'nginx:port=80' }, { nginx: '1.26.0' }));

    expect(ports).toEqual([{ port: 80, service: 'http', version: 'nginx/1.26.0' }]);
  });

  it('has no version for a listener the world cannot even name', () => {
    // A planted backdoor is somebody process, not a package. There is no row to read a
    // version from, and inventing one would hand the defender a lead that does not
    // exist — the empty cell is what marks the port as unaccounted for.
    const ports = readOpenPorts(
      boxRunning(
        { 'nc-4444.pid': formatListenerContent({ port: 4444, user: 'mallory', userType: 'root' }) },
        { 'openssh-server': '9.7.0' },
      ),
    );

    expect(ports).toEqual([{ port: 4444, service: 'unknown', version: undefined }]);
  });

  it('has no version for a daemon its own manifest does not list', () => {
    // A running daemon with no package block cannot be answered for. Falling back to
    // the starting version would state a fact the box does not hold.
    const ports = readOpenPorts(boxRunning({ 'sshd.pid': 'sshd:port=22' }, { libz: '1.3.1' }));

    expect(ports[0]?.version).toBeUndefined();
  });

  it('survives every shape a mangled /var/lib/dpkg can take, and reports no version', () => {
    // Root on your own box can `rm /var/lib/dpkg/status`, or `mkdir` straight over it.
    // Each of these is a tree a player can really produce, and a scan that threw on one
    // would be a crash any owner could trigger on demand — so a broken path reads as a
    // box with nothing to declare, exactly as a missing file does.
    const withVarLib = (lib: Directory) =>
      buildDirectory({
        var: buildDirectory({
          run: buildDirectory({ 'sshd.pid': buildFile('sshd:port=22', { owner: 'root' }) }),
          lib,
        }),
      });

    const mangled: readonly Directory[] = [
      // `/var/lib` with no dpkg directory under it at all.
      withVarLib(buildDirectory({})),
      // `dpkg` is a FILE where a directory belongs.
      withVarLib(buildDirectory({ dpkg: buildFile('not a directory', { owner: 'root' }) })),
      // The directory is there and the status file is gone.
      withVarLib(buildDirectory({ dpkg: buildDirectory({}) })),
      // `status` is a DIRECTORY wearing the file's name.
      withVarLib(buildDirectory({ dpkg: buildDirectory({ status: buildDirectory({}) }) })),
    ];

    for (const tree of mangled) {
      expect(readOpenPorts(tree)).toEqual([{ port: 22, service: 'ssh' }]);
    }
  });

  it('has no version on a box carrying no manifest at all', () => {
    // Every generated box has one, but a tree assembled by a test or a half-built patch
    // may not, and a missing file is a missing answer rather than a crash.
    expect(readOpenPorts(varRun({ 'sshd.pid': 'sshd:port=22' }))[0]?.version).toBeUndefined();
  });
});

/**
 * The vulnerability rides beside the version because it is derived from it — one read
 * of one box answers both, so a scan can never name a version and a CVE that belong to
 * different software.
 *
 * The day is a PARAMETER and an optional one. Most readers here only ask whether a port
 * is open — the login gates, `ftp`, `scp`, `hydra` — and have no opinion about time; a
 * caller that never asked about a clock gets no CVE, which is the honest answer rather
 * than a default.
 */
describe('the vulnerability a scanned port advertises', () => {
  /** Long after every package in the world has published its first CVE. */
  const LATE = 9999;
  /** `openssh-server` publishes on day 8 in this world; the suite pins that world. */
  const SSH_PUBLISHES_ON = 8;
  const runningSshd = { 'sshd.pid': 'sshd:port=22' };
  const shippingSsh = { 'openssh-server': '9.7.0' };

  it('names the CVE live against the version the box is actually running', () => {
    const ports = readOpenPorts(boxRunning(runningSshd, shippingSsh), {
      gameDay: SSH_PUBLISHES_ON,
    });

    expect(ports).toEqual([
      {
        port: 22,
        service: 'ssh',
        version: 'OpenSSH 9.7.0',
        cve: 'CVE-2026-0149031',
        severity: 'medium',
      },
    ]);
  });

  it('carries what the hole IS and nothing about what firing it would get you', () => {
    // The effect and the tier are derivable right here, from the same package and the
    // same day this projection already has. They stay out of it because this row is
    // what a cross-player scan SENDS to somebody else's client — a field added here
    // would have to be produced by every server path and trusted from each one, to
    // hand over an answer the player is supposed to have to fire for.
    const granted = exploitOutcome('openssh-server', '9.7.0', SSH_PUBLISHES_ON);
    if (granted === undefined) throw new Error('this world stopped publishing the hole');

    const [port] = readOpenPorts(boxRunning(runningSshd, shippingSsh), {
      gameDay: SSH_PUBLISHES_ON,
    });
    if (port === undefined) throw new Error('the box stopped advertising its daemon');

    expect(Object.keys(port).sort()).toEqual(['cve', 'port', 'service', 'severity', 'version']);
    expect(Object.values(port)).not.toContain(granted.effect);
    expect(Object.values(port)).not.toContain(granted.tier);
  });

  it('says nothing while the package is still inside its safe window', () => {
    // The version is public from the first day; the hole is not, because it does not
    // exist yet. A scan that leaked tomorrow's CVE would let a player queue up an
    // attack on a box nobody could yet defend.
    const ports = readOpenPorts(boxRunning(runningSshd, shippingSsh), {
      gameDay: SSH_PUBLISHES_ON - 1,
    });

    expect(ports).toEqual([{ port: 22, service: 'ssh', version: 'OpenSSH 9.7.0' }]);
  });

  it('answers nothing about vulnerability to a caller that asked nothing about time', () => {
    expect(readOpenPorts(boxRunning(runningSshd, shippingSsh))).toEqual([
      { port: 22, service: 'ssh', version: 'OpenSSH 9.7.0' },
    ]);
  });

  it('has none for a listener the world cannot even name', () => {
    // No package behind it means no version, and no version means nothing a CVE could
    // be keyed on. A planted backdoor is a hole with no published number.
    const ports = readOpenPorts(
      boxRunning({ 'nc-4444.pid': 'nc:port=4444,user=mallory,userType=root' }),
      { gameDay: LATE },
    );

    expect(ports).toEqual([{ port: 4444, service: 'unknown' }]);
  });

  it('has none for a daemon its own manifest does not list', () => {
    const ports = readOpenPorts(boxRunning(runningSshd), { gameDay: LATE });

    expect(ports).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('has none for a version the package never shipped', () => {
    // Reachable by hand: the manifest is root-writable, so this is a line a player can
    // type. It reads as clean today, when nothing is exploitable either way.
    const ports = readOpenPorts(boxRunning(runningSshd, { 'openssh-server': '9.9.9' }), {
      gameDay: LATE,
    });

    expect(ports).toEqual([{ port: 22, service: 'ssh', version: 'OpenSSH 9.9.9' }]);
  });
});
