/**
 * The name of the account a generated NPC box carries at uid 1000, keyed by what
 * the box is for.
 *
 * This is the last thing a player reads on a box, and the first thing they type:
 * `hydra` hands the name back, `ssh` takes it, `su` takes it again. A single flat
 * pool undid at the login prompt what the hostname said at the scan — a doorbell
 * whose one account is `deploy` is a doorbell nobody deployed anything to.
 *
 * The vocabulary is legacy's `usernamesByRole`, adopted rather than coined, with
 * two deliberate deviations:
 *
 * **No name belongs to two kinds of box.** Legacy shared `admin` and `operator`
 * across workstation, iot and router, and spelled a mail daemon and a person called
 * D. Kim the same way. A name that could have come from two kinds of box is not
 * evidence, which is the whole reason for keying the pool; the shared names live in
 * the generic pool instead, where nothing is claimed by drawing them.
 *
 * **No name claims a daemon this world does not run.** Legacy's database pool held
 * `postgres`, `mongo`, `redis` and `cassandra`, and its fileserver pool held `nfs`
 * and `samba` — on boxes whose config files here say `mysql.cnf` and `vsftpd.conf`.
 * An account is weaker evidence than a config stanza, but it is read the same way,
 * and a box that names a daemon nothing in the game can reach sends a player after
 * something that does not exist. The rule `configFiles.ts` follows, followed here.
 *
 * The draw takes the CALLER's prng rather than a seed of its own, which is the
 * opposite of what `pickWebPage` and `roleConfigFile` do — and for the same reason
 * they take their own. The name is drawn from the host-fs stream immediately before
 * the passwords, so a stream of its own would remove that draw from the sequence and
 * re-roll every NPC password in the world. Keeping the draw where it is keeps every
 * password where it is: `pick` consumes exactly one `next()` whatever the pool's
 * width, and the host-fs seed is the box's ADDRESS rather than its name, so the same
 * address answers with the same credentials whatever the box turned out to be. A
 * test in `remoteHostFs.test.ts` holds that, hash for hash, rather than trusting it.
 */

import type { Prng } from '../prng';
import type { DrawnRole } from '../machineRole';

/** What a box whose name claims no role carries: service accounts general enough to
 *  say nothing about the machine. A deep NPC named from its gateway's stream can
 *  wear a name no role claims, and this is the right answer for it rather than a gap
 *  to fill later. */
const GENERIC_USERNAMES: readonly string[] = [
  'admin',
  'ubuntu',
  'pi',
  'deploy',
  'dev',
  'operator',
  'support',
  'backup',
];

/** Total over the seven drawn roles, unlike the sparse page table: every kind of box
 *  has somebody on it, so an absent row here would be a box with no account rather
 *  than a box with nothing particular to say. */
const USERNAMES_BY_ROLE: Readonly<Record<DrawnRole, readonly string[]>> = {
  workstation: [
    'jsmith',
    'developer',
    'analyst',
    'mrodriguez',
    'pwilson',
    'sthompson',
    'klee',
    'rjohnson',
    'agarcia',
    'jchen',
    'bpatel',
    'nwilliams',
    'hkim',
    'tnguyen',
    'lschmidt',
  ],
  iot: [
    'device',
    'iotuser',
    'sensor',
    'mqtt',
    'telemetry',
    'gateway',
    'controller',
    'monitor',
    'zigbee',
    'modbus',
    'plcuser',
    'firmware',
    'otauser',
    'camadmin',
    'rtsp',
  ],
  webserver: [
    'www-data',
    'webadmin',
    'apache',
    'nginx',
    'devops',
    'httpd',
    'proxy',
    'caddy',
    'webops',
    'varnish',
    'siteadm',
    'frontend',
    'haproxy',
    'webdeploy',
    'webmaster',
  ],
  fileserver: [
    'ftpuser',
    'storage',
    'sysadmin',
    'fileadm',
    'archive',
    'rsync',
    'datamgr',
    'shareuser',
    'sftp',
    'syncuser',
    'nasadmin',
    'docmgr',
    'vsftpd',
    'fileops',
    'uploads',
  ],
  database: [
    'dbadmin',
    'mysql',
    'dba',
    'dataops',
    'dbuser',
    'replication',
    'analytics',
    'etl',
    'sqldev',
    'dbops',
    'dataeng',
    'sqladmin',
    'dbmaint',
    'dbsvc',
    'reporting',
  ],
  mailserver: [
    'postmaster',
    'mailadm',
    'dovecot',
    'smtp-svc',
    'mailops',
    'listadm',
    'relay',
    'quarantine',
    'mxops',
    'imapuser',
    'spamfilter',
    'mailarch',
    'dkim',
    'fetchmail',
    'popuser',
  ],
  dns: [
    'named',
    'bind',
    'dnsadm',
    'dnsop',
    'zonefile',
    'resolver',
    'nsadmin',
    'dnsuser',
    'zoneadm',
    'dnsmgr',
    'nsops',
    'axfradm',
    'dnseng',
    'cacheadm',
    'rndc',
  ],
};

/** The account `role`'s box carries, drawn from the caller's stream at the position
 *  the flat pool was drawn from. */
export const pickUsername = ({
  prng,
  role,
}: {
  readonly prng: Prng;
  readonly role: DrawnRole | undefined;
}): string => prng.pick(role === undefined ? GENERIC_USERNAMES : USERNAMES_BY_ROLE[role]);
