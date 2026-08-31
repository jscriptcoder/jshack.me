import { describe, expect, it } from 'vitest';
import type { Directory, FilePermissions } from '../filesystem/types';
import type { OpenPort } from '../services/pidfile';
import { dir, file, TRAVERSABLE_DIR } from '../generation/baseFs';
import { scanResult } from './scanResult';

const FILE_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/**
 * A minimal router FS for the scan: just the two things `scanResult` reads —
 * `/var/run/*.pid` (the router's OWN open ports) and `/etc/iptables/rules.v4`
 * (the parsed NAT forward table). Defaults to a router running its own sshd:22.
 */
const makeRouterFs = (
  rulesV4: string,
  ownPidfiles: Readonly<Record<string, string>> = { 'sshd.pid': 'sshd:port=22' },
): Directory =>
  dir(
    {
      etc: dir(
        { iptables: dir({ 'rules.v4': file(rulesV4, FILE_PERMS) }, TRAVERSABLE_DIR) },
        TRAVERSABLE_DIR,
      ),
      var: dir(
        {
          run: dir(
            Object.fromEntries(
              Object.entries(ownPidfiles).map(([name, content]) => [
                name,
                file(content, FILE_PERMS),
              ]),
            ),
            TRAVERSABLE_DIR,
          ),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );

/** A target whose `10.0.0.5` host runs ssh on :22; every other host is dark. */
const wsHasSsh = (internalIp: string): readonly OpenPort[] =>
  internalIp === '10.0.0.5' ? [{ port: 22, service: 'ssh' }] : [];

const noOpenPorts = (): readonly OpenPort[] => [];

describe('scanResult', () => {
  it('sameLAN shows the router OWN ports only', () => {
    const fs = makeRouterFs('forward 2222 to 10.0.0.5:22'); // a LIVE forward present
    // ...but sameLAN (a host on the LAN scanning the router's .1) never sees it.
    expect(scanResult({ vantage: 'sameLAN', routerFs: fs, resolveTargetPorts: wsHasSsh })).toEqual([
      { port: 22, service: 'ssh' },
    ]);
  });

  it('external with no forwards shows the router own ports only (workstation dark behind NAT)', () => {
    const fs = makeRouterFs(''); // opt-in default: no forward configured
    expect(
      scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: noOpenPorts }),
    ).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('external surfaces a live forward at its PUBLIC port with the target service label', () => {
    const fs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    expect(scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsHasSsh })).toEqual(
      [
        { port: 22, service: 'ssh' }, // the router's own sshd
        { port: 2222, service: 'ssh' }, // the forward → ws:22 (ssh), shown at public 2222
      ],
    );
  });

  it('external DROPS a forward whose target port is down (liveness gate)', () => {
    const fs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    // The workstation is reachable but its sshd is NOT up → the forward is dead.
    const wsDark = (): readonly OpenPort[] => [];
    expect(scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsDark })).toEqual([
      { port: 22, service: 'ssh' },
    ]);
  });

  it('external DROPS a forward when the target serves a DIFFERENT port than the rule maps to', () => {
    // The host is up on :80, but the forward maps the internal :22 — which is
    // down. A live forward needs the SPECIFIC mapped port, not just any open one.
    const fs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    const wsWrongPort = (internalIp: string): readonly OpenPort[] =>
      internalIp === '10.0.0.5' ? [{ port: 80, service: 'http' }] : [];
    expect(
      scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsWrongPort }),
    ).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('external labels a forward with the MATCHING target port service, not just the first open port', () => {
    const fs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    // Target serves both :80 and :22 — the forward maps :22, so the label is ssh.
    const wsMulti = (internalIp: string): readonly OpenPort[] =>
      internalIp === '10.0.0.5'
        ? [
            { port: 80, service: 'http' },
            { port: 22, service: 'ssh' },
          ]
        : [];
    expect(scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsMulti })).toEqual([
      { port: 22, service: 'ssh' },
      { port: 2222, service: 'ssh' },
    ]);
  });

  it('external forwards nothing when the router has no rules.v4 table (missing /etc, dir, or file)', () => {
    const sshOnlyRun = dir(
      { run: dir({ 'sshd.pid': file('sshd:port=22', FILE_PERMS) }, TRAVERSABLE_DIR) },
      TRAVERSABLE_DIR,
    );
    const withVar = (extra: Record<string, Directory>): Directory =>
      dir({ ...extra, var: sshOnlyRun }, TRAVERSABLE_DIR);
    const variants = [
      withVar({}), // no /etc
      withVar({ etc: dir({}, TRAVERSABLE_DIR) }), // /etc but no iptables
      withVar({ etc: dir({ iptables: dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR) }), // no rules.v4
    ];
    variants.forEach((fs) => {
      expect(
        scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsHasSsh }),
      ).toEqual([{ port: 22, service: 'ssh' }]);
    });
  });

  it('external does NOT double-list a port the router owns when a forward also maps to it', () => {
    // A forward to public 22 collides with the router's own sshd:22 — dedupe.
    const fs = makeRouterFs('forward 22 to 10.0.0.5:22');
    expect(scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsHasSsh })).toEqual(
      [{ port: 22, service: 'ssh' }],
    );
  });

  it('sameLAN omits a port the router own filter denies, and leaves the rest listed', () => {
    // A scan that still advertised a filtered port would hand a stranger the one signal
    // every other dark state hides: an address bearing no network, a bricked box, a
    // stopped daemon and a filtered port all have to read alike, or the filter becomes a
    // pointer to the port worth attacking.
    const fs = makeRouterFs('deny 22', {
      'sshd.pid': 'sshd:port=22',
      'snmpd.pid': 'snmpd:port=161',
    });
    expect(
      scanResult({ vantage: 'sameLAN', routerFs: fs, resolveTargetPorts: noOpenPorts }),
    ).toEqual([{ port: 161, service: 'snmp' }]);
  });

  it('external omits a port the router own filter denies', () => {
    // Both vantages are somebody else's box seen from the network, so one filter answers
    // both. The box stays UP with its other ports listed — a filtered port goes absent,
    // never taking the host down with it.
    const fs = makeRouterFs('deny 22', {
      'sshd.pid': 'sshd:port=22',
      'snmpd.pid': 'snmpd:port=161',
    });
    expect(
      scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: noOpenPorts }),
    ).toEqual([{ port: 161, service: 'snmp' }]);
  });

  it('external leaves a FORWARD standing when the gateway denies that public port', () => {
    // An INPUT rule governs traffic the box TERMINATES, never traffic it passes through:
    // closing the gateway's own door cannot close one an occupant opened onto their
    // workstation. The cross-player reach already draws the line there, and a scan that
    // drew it anywhere else would make one of the two a liar.
    const fs = makeRouterFs(['deny 2222', 'forward 2222 to 10.0.0.5:22'].join('\n'), {
      'snmpd.pid': 'snmpd:port=161',
    });
    expect(scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsHasSsh })).toEqual([
      { port: 161, service: 'snmp' },
      { port: 2222, service: 'ssh' },
    ]);
  });

  it('external lists a public port ONCE when two forward lines both claim it', () => {
    // Nothing stops a hand-edited table naming one public port twice — the snmp door
    // overwrites, but `nano` appends. First rule wins and the port is listed once,
    // rather than the same port appearing at two different services.
    const fs = makeRouterFs(
      ['forward 2222 to 10.0.0.5:22', 'forward 2222 to 10.0.0.6:80'].join('\n'),
    );
    const bothServing = (internalIp: string): readonly OpenPort[] =>
      internalIp === '10.0.0.5' ? [{ port: 22, service: 'ssh' }] : [{ port: 80, service: 'http' }];
    expect(
      scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: bothServing }),
    ).toEqual([
      { port: 22, service: 'ssh' },
      { port: 2222, service: 'ssh' },
    ]);
  });

  it('external keeps a public port DARK when the router own denied service holds it, forward or not', () => {
    // The router's own service owns a public port whether or not the filter lets it
    // answer. Precedence that flipped with the filter state would let a denied port
    // re-open itself through somebody else's forward — and the reach, which routes on
    // the pidfiles, would go on refusing it. The scan would then be advertising a door
    // nobody can walk through, which is the same lie as hiding one that works.
    const fs = makeRouterFs(['deny 22', 'forward 22 to 10.0.0.5:22'].join('\n'), {
      'sshd.pid': 'sshd:port=22',
      'snmpd.pid': 'snmpd:port=161',
    });
    expect(scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsHasSsh })).toEqual([
      { port: 161, service: 'snmp' },
    ]);
  });

  it('sameLAN never consults the forward table even when a target port is up', () => {
    // The dual-homed invariant: a forward live on the public side is invisible
    // from inside the LAN. Same forward, same live target, two vantages.
    const fs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    const lan = scanResult({ vantage: 'sameLAN', routerFs: fs, resolveTargetPorts: wsHasSsh });
    const ext = scanResult({ vantage: 'external', routerFs: fs, resolveTargetPorts: wsHasSsh });
    expect(lan.map((openPort) => openPort.port)).toEqual([22]);
    expect(ext.map((openPort) => openPort.port)).toEqual([22, 2222]);
  });
});
