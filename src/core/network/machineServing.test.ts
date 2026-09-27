import { describe, expect, it } from 'vitest';
import type { Directory, FilePermissions } from '../filesystem/types';
import { dir, file, TRAVERSABLE_DIR } from '../generation/baseFs';
import { machineServing } from './machineServing';
import { withForward } from './iptablesRules';

const FILE_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/**
 * A minimal router FS for `machineServing`: the two things it reads to route a
 * destination port — `/var/run/*.pid` (the router's OWN listening ports) and
 * `/etc/iptables/rules.v4` (the parsed NAT forward table). Defaults to a router
 * running its own sshd:22, like a freshly seeded box.
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

describe('machineServing', () => {
  it('routes a router OWN port to the router itself', () => {
    const routerFs = makeRouterFs(''); // opt-in default: no forward, just the router's sshd:22
    expect(machineServing({ routerFs, port: 22 })).toEqual({ kind: 'router' });
  });

  it('routes a forwarded public port to its internal target host and port', () => {
    const routerFs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    expect(machineServing({ routerFs, port: 2222 })).toEqual({
      kind: 'forward',
      internalIp: '10.0.0.5',
      internalPort: 22,
    });
  });

  it('serves nothing for a port that is neither a router own port nor a forward', () => {
    const routerFs = makeRouterFs('forward 2222 to 10.0.0.5:22');
    expect(machineServing({ routerFs, port: 9999 })).toEqual({ kind: 'none' });
  });

  it('does not route a port to a router that serves NO ports of its own', () => {
    // A router with no running services (e.g. sshd off) owns no port — :22 must not
    // resolve to it just because the router happens to be the box behind the IP.
    const routerFs = makeRouterFs('', {}); // no pidfiles → zero open ports
    expect(machineServing({ routerFs, port: 22 })).toEqual({ kind: 'none' });
  });

  it('ignores malformed / commented / blank rules when routing', () => {
    const routerFs = makeRouterFs(
      ['# forward 2222 to 10.0.0.5:22', '', 'forward 70000 to 10.0.0.5:22', 'garbage line'].join(
        '\n',
      ),
    );
    // The only "forward" lines are a comment, an out-of-range port, and junk — none
    // parse, so 2222 (the commented-out target) is not actually served.
    expect(machineServing({ routerFs, port: 2222 })).toEqual({ kind: 'none' });
  });

  it('lets a router own port win over a forward mapped to the same public port', () => {
    // A forward to public 22 collides with the router's own sshd:22 — you reach the
    // router, never the internal host, on its own service port.
    const routerFs = makeRouterFs('forward 22 to 10.0.0.5:80');
    expect(machineServing({ routerFs, port: 22 })).toEqual({ kind: 'router' });
  });

  it('serves a forward that `snmpset` wrote, exactly as it serves one typed into nano', () => {
    // The point of the whole door: a forward opened over SNMP with no shell is the
    // SAME fact as one an owner typed in — one file, one parser, one routing decision.
    // If these two paths could disagree, a player would see their forward in a walk and
    // find nothing behind it, which is the failure the view-over-the-file design exists
    // to make impossible.
    const opened = withForward('# NAT rules', 2222, {
      internalIp: '10.0.0.10',
      internalPort: 22,
    });

    expect(machineServing({ routerFs: makeRouterFs(opened), port: 2222 })).toEqual({
      kind: 'forward',
      internalIp: '10.0.0.10',
      internalPort: 22,
    });

    // And closing it again puts the port back to serving nobody, rather than leaving a
    // line the router still honours.
    const closed = withForward(opened, 2222, null);
    expect(machineServing({ routerFs: makeRouterFs(closed), port: 2222 })).toEqual({
      kind: 'none',
    });
  });
});
