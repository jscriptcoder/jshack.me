/**
 * What a generated box keeps in `/etc` beyond its accounts and its role config: its own
 * name, the neighbours its admin wrote down, where it asks for names, what it mounts,
 * what its root runs on a schedule, and the greeting it prints at login.
 *
 * All of it is readable by a guest — the lowest tier of recon, like the role config
 * beside it — so none of it may name the box's own account, and this builder is never
 * handed one. Every host, address and path a file names is really there: the
 * neighbours come from the LAN itself, the resolver is the network's own gateway, and a
 * job that looks after a service is scheduled only on a box that runs it.
 *
 * A box that is not on the home LAN (a deep-layer NPC) has no neighbours it can know
 * about, so its `/etc/hosts` names only itself and its tree stays the same whether or
 * not its layer hangs a child. Everything here draws from the box's own `etc-content`
 * stream, so no other concern's draws move.
 */

import type { FileEntry } from '../filesystem/types';
import { file, SERVICE_CONFIG_FILE } from './baseFs';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import type { HostService } from './remoteHostFs';
import type { DrawnRole } from './machineRole';
import { networkPersona } from './persona';
import { lanZoneName } from '../network/resolveName';
import { createPrng, type Prng } from './prng';
import {
  DEBIAN_CRONTAB_HEADER,
  DEBIAN_FSTAB_HEADER,
  DEBIAN_HOSTS_IPV6,
  GENERIC_CRON_JOBS,
  MOTD_TEMPLATES,
  NAME_SERVER_CRON_JOBS,
  SERVICE_CRON_JOBS,
} from './pools/etcFiles';

const HEX_DIGITS = '0123456789abcdef';

const hex = (prng: Prng, length: number): string =>
  Array.from({ length }, () => HEX_DIGITS[prng.nextInt(0, 15)]).join('');

const uuid = (prng: Prng): string =>
  [hex(prng, 8), hex(prng, 4), hex(prng, 4), hex(prng, 4), hex(prng, 12)].join('-');

const hostsFile = (options: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly onLan: boolean;
}): string => {
  const { prng, essid, host, onLan } = options;
  if (!onLan) return `127.0.0.1\tlocalhost\n127.0.1.1\t${host.hostname}\n\n${DEBIAN_HOSTS_IPV6}`;

  const zone = lanZoneName(essid);
  // Only machines: two routers on one LAN can share a hostname, so a router's name is not
  // one an admin could pin to an address.
  const machines = generateHomeLan(essid).hosts.filter(
    (candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip,
  );
  const pinned = prng
    .pickN(machines, prng.nextInt(0, 3))
    .map((neighbour) => `${neighbour.ip}\t${neighbour.hostname}.${zone} ${neighbour.hostname}\n`);
  const local = `127.0.0.1\tlocalhost\n127.0.1.1\t${host.hostname}.${zone} ${host.hostname}\n`;
  return `${local}\n${DEBIAN_HOSTS_IPV6}${pinned.length === 0 ? '' : `\n${pinned.join('')}`}`;
};

const resolvConf = (essid: string, host: LanHost, onLan: boolean): string => {
  const gateway = `${host.ip.split('.').slice(0, 3).join('.')}.1`;
  return `${onLan ? `search ${lanZoneName(essid)}\n` : ''}nameserver ${gateway}\n`;
};

const fstab = (prng: Prng): string => {
  const root = `UUID=${uuid(prng)} /               ext4    errors=remount-ro 0       1\n`;
  const boot = prng.next() < 0.4 ? `UUID=${uuid(prng)} /boot           ext4    defaults        0       2\n` : '';
  const swap = prng.next() < 0.75 ? `UUID=${uuid(prng)} none            swap    sw              0       0\n` : '';
  return `${DEBIAN_FSTAB_HEADER}${root}${boot}${swap}`;
};

/** A schedule in cron's five fields: hourly, daily or weekly, at a drawn time. */
const schedule = (prng: Prng): string => {
  const minute = prng.nextInt(0, 59);
  const hour = prng.nextInt(0, 23);
  return prng.pick([
    `${minute} *\t* * *`,
    `${minute} ${hour}\t* * *`,
    `${minute} ${hour}\t* * ${prng.nextInt(0, 6)}`,
  ]);
};

const crontab = (options: {
  readonly prng: Prng;
  readonly services: readonly HostService[];
  readonly role: DrawnRole | undefined;
}): string => {
  const { prng, services, role } = options;
  const generic = prng.pickN(GENERIC_CRON_JOBS, prng.nextInt(1, 3));
  const forServices = services.flatMap(({ spec }) => {
    const jobs = SERVICE_CRON_JOBS[spec.service] ?? [];
    return jobs.length === 0 || prng.next() < 0.5 ? [] : [prng.pick(jobs)];
  });
  const forNameServer = role === 'dns' ? [prng.pick(NAME_SERVER_CRON_JOBS)] : [];
  const jobs = [...generic, ...forServices, ...forNameServer].map(
    (command) => `${schedule(prng)}\troot\t${command}\n`,
  );
  return `${DEBIAN_CRONTAB_HEADER}${jobs.join('')}`;
};

const motd = (prng: Prng, essid: string, host: LanHost): string => {
  const persona = networkPersona(essid);
  return prng
    .pick(MOTD_TEMPLATES[persona.category])
    .replaceAll('{place}', persona.place)
    .replaceAll('{hostname}', host.hostname);
};

/** The `/etc` files this box keeps beside its accounts and role config, by name. */
export const buildEtcContent = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly services: readonly HostService[];
  readonly role: DrawnRole | undefined;
}): Readonly<Record<string, FileEntry>> => {
  const { essid, host, services, role } = options;
  const prng = createPrng(`etc-content-${essid}-${host.ip}`);
  const onLan = isOnHomeLan(essid, host);
  const etcFile = (content: string): FileEntry => file(content, SERVICE_CONFIG_FILE);
  return {
    hostname: etcFile(`${host.hostname}\n`),
    hosts: etcFile(hostsFile({ prng, essid, host, onLan })),
    'resolv.conf': etcFile(resolvConf(essid, host, onLan)),
    fstab: etcFile(fstab(prng)),
    crontab: etcFile(crontab({ prng, services, role })),
    motd: etcFile(motd(prng, essid, host)),
  };
};
