/**
 * The `.ssh/` a generated box keeps: the neighbours it has reached over ssh, and — on a
 * desk somebody sits at — the shortcuts they set up to reach them.
 *
 * Every entry is a neighbouring MACHINE on the home LAN that really runs `sshd`, on the
 * port it really listens on; every `config` block logs in as that neighbour's real
 * account. A router is never listed: two routers on one LAN can share a hostname. A box
 * with no such neighbour has met nobody and keeps no `.ssh/`, and a deep-layer box knows
 * no neighbours at all. The host keys are fiction — nothing in the game checks one.
 *
 * Root's `.ssh/` and the desk owner's share one `ssh-content` stream, drawn root first,
 * so neither moves any other concern's draws.
 */

import type { Directory } from '../filesystem/types';
import { dir, file, HOME_DIR, HOME_FILE, ROOT_DIR, ROOT_FILE } from './baseFs';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { hostServices, npcUsername } from './remoteHostFs';
import { isDeskMachine } from './npcHome';
import { lanZoneName } from '../network/resolveName';
import { createPrng, type Prng } from './prng';

type SshNeighbour = { readonly host: LanHost; readonly port: number };

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** An ed25519 public key as `known_hosts` spells it: the fixed prefix that encodes the
 *  key type, then the key itself. */
const hostKey = (prng: Prng): string =>
  `AAAAC3NzaC1lZDI1NTE5AAAAI${Array.from({ length: 43 }, () => BASE64[prng.nextInt(0, 63)]).join('')}`;

const sshNeighbours = (essid: string, self: LanHost): readonly SshNeighbour[] =>
  generateHomeLan(essid)
    .hosts.filter((host) => host.kind === 'machine' && host.ip !== self.ip)
    .flatMap((host) => {
      const ssh = hostServices(essid, host).find(({ spec }) => spec.service === 'ssh');
      return ssh === undefined ? [] : [{ host, port: ssh.port }];
    });

/** `known_hosts` for a handful of the neighbours, as ssh writes it: `name,address` on the
 *  standard port, `[address]:port` on any other. */
const knownHosts = (prng: Prng, met: readonly SshNeighbour[]): string =>
  met
    .map(({ host, port }) => {
      const names = port === 22 ? `${host.hostname},${host.ip}` : `[${host.ip}]:${port}`;
      return `${names} ssh-ed25519 ${hostKey(prng)}\n`;
    })
    .join('');

/** Settings a person puts under `Host *`, the defaults for every connection. None names a
 *  host or a file. */
const DEFAULT_OPTIONS: readonly ((prng: Prng) => string)[] = [
  (prng) => `ServerAliveInterval ${prng.pick([15, 30, 60, 120])}`,
  (prng) => `ServerAliveCountMax ${prng.nextInt(2, 6)}`,
  (prng) => `ConnectTimeout ${prng.pick([5, 10, 20, 30])}`,
  (prng) => `ForwardAgent ${prng.pick(['yes', 'no'])}`,
  (prng) => `Compression ${prng.pick(['yes', 'no'])}`,
  (prng) => `AddKeysToAgent ${prng.pick(['yes', 'no', 'confirm'])}`,
  (prng) => `HashKnownHosts ${prng.pick(['yes', 'no'])}`,
  (prng) => `StrictHostKeyChecking ${prng.pick(['ask', 'accept-new'])}`,
];

/** `~/.ssh/config`: the person's defaults, then a shortcut for some of the neighbours
 *  this desk has met. */
const sshConfig = (prng: Prng, essid: string, met: readonly SshNeighbour[]): string => {
  const defaults = prng
    .pickN(DEFAULT_OPTIONS, prng.nextInt(1, 3))
    .map((option) => `    ${option(prng)}\n`)
    .join('');
  const shortcuts = prng.pickN(met, prng.nextInt(1, 2)).map(({ host, port }) => {
    const hostName = prng.pick([host.ip, `${host.hostname}.${lanZoneName(essid)}`]);
    const portLine = port === 22 ? '' : `    Port ${port}\n`;
    return `Host ${host.hostname}\n    HostName ${hostName}\n    User ${npcUsername(essid, host)}\n${portLine}`;
  });
  return [`Host *\n${defaults}`, ...shortcuts].join('\n');
};

/** The `.ssh/` directories this box keeps: root's, and the desk owner's where somebody
 *  sits at it. Either is null where there is nothing to remember. */
export const buildSshDirectories = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
}): { readonly root: Directory | null; readonly home: Directory | null } => {
  const { essid, host, username } = options;
  const neighbours = isOnHomeLan(essid, host) ? sshNeighbours(essid, host) : [];
  if (neighbours.length === 0) return { root: null, home: null };

  const prng = createPrng(`ssh-content-${essid}-${host.ip}`);
  const rootMet = prng.pickN(neighbours, prng.nextInt(1, 4));
  const root = dir({ known_hosts: file(knownHosts(prng, rootMet), ROOT_FILE) }, ROOT_DIR);
  if (!isDeskMachine(host)) return { root, home: null };

  const homeMet = prng.pickN(neighbours, prng.nextInt(1, 4));
  const home = dir(
    {
      known_hosts: file(knownHosts(prng, homeMet), HOME_FILE, username),
      config: file(sshConfig(prng, essid, homeMet), HOME_FILE, username),
    },
    HOME_DIR,
    username,
  );
  return { root, home };
};
