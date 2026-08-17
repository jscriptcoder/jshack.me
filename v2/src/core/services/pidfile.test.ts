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
    ];

    for (const content of malformed) {
      expect(readRunningProcesses(varRun({ 'nc-4444.pid': content }))).toEqual([]);
    }
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
