import { describe, expect, it } from 'vitest';
import { portsOpenToNetwork } from './portsOpenToNetwork';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import type { Directory } from '../filesystem/types';

/**
 * What a box answers to the NETWORK, as against what is running on it.
 *
 * The two were the same fact until a box could keep a filter about itself. They must
 * not be merged now: `ps`, the owner's own scan and the pidfiles themselves still
 * report a filtered daemon as running, because it IS — that is the whole reason to
 * prefer a filter to `systemctl stop`, which takes the service away from its owner too.
 */

/** A box serving a store and ssh, with whatever its `rules.v4` says. */
const boxServing = (rules: string): Directory =>
  buildDirectory({
    etc: buildDirectory({ iptables: buildDirectory({ 'rules.v4': buildFile(rules) }) }),
    var: buildDirectory({
      run: buildDirectory({
        [SERVICE_CATALOG.redis.pidfile]: buildFile(
          formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
        ),
        [SERVICE_CATALOG.ssh.pidfile]: buildFile(
          formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
        ),
      }),
    }),
  });

const portsOf = (root: Directory): readonly number[] =>
  portsOpenToNetwork(root).map((open) => open.port);

describe('portsOpenToNetwork', () => {
  it('drops a port the box denies and keeps every other one', () => {
    expect(portsOf(boxServing(`deny ${SERVICE_CATALOG.redis.defaultPort}\n`))).toEqual([
      SERVICE_CATALOG.ssh.defaultPort,
    ]);
  });

  it('is everything that is listening on a box that denies nothing', () => {
    const open = portsOf(boxServing('# local filter\n'));

    expect(open).toContain(SERVICE_CATALOG.redis.defaultPort);
    expect(open).toContain(SERVICE_CATALOG.ssh.defaultPort);
  });

  it('is unmoved by a deny naming a port nothing serves', () => {
    // A filter is not a claim about what runs. Closing 8080 on a box serving nothing
    // there changes what arrives and changes nothing about what is listening.
    expect(portsOf(boxServing('deny 8080\n'))).toEqual(portsOf(boxServing('')));
  });

  it('is unmoved by a deny the owner commented out', () => {
    // The obvious way to park a rule. Honoured here, a note would close a port its
    // owner had deliberately re-opened.
    expect(portsOf(boxServing(`# deny ${SERVICE_CATALOG.redis.defaultPort}\n`))).toContain(
      SERVICE_CATALOG.redis.defaultPort,
    );
  });

  it("is unmoved by a gateway's forwards, which open ports rather than close them", () => {
    // Both chains share this file. A filter that read a forward as a rule about itself
    // would close whichever port a gateway had just published.
    expect(portsOf(boxServing('forward 2222 to 192.168.1.9:22\n'))).toEqual(portsOf(boxServing('')));
  });

  it('reports what is listening on a box carrying no filter file at all', () => {
    // Every generated box, and every player box before `apt install snmp`. An absent
    // file is an empty filter, never an empty box.
    const noEtc = buildDirectory({
      var: buildDirectory({
        run: buildDirectory({
          [SERVICE_CATALOG.ssh.pidfile]: buildFile(
            formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
          ),
        }),
      }),
    });

    expect(portsOf(noEtc)).toEqual([SERVICE_CATALOG.ssh.defaultPort]);
  });
});
