/**
 * The hand-written text behind a generated box's `/etc`: the greeting it prints at login
 * and the jobs its root has scheduled.
 *
 * Everything here is readable by a guest, so the rules are strict, and the tests hold
 * the output to them:
 * - **No account.** Nothing names the box's own user; there is no slot for it. A
 *   crontab job always runs as root.
 * - **Every path is one the box has.** A job names `/tmp`, `/var/log`, `/etc`, `/root`
 *   or `/home`, which every box carries; a job that names a service's own directory is
 *   filed under that service and scheduled only on a box that runs it. Nothing writes
 *   to a file the box does not have, so nothing sends output to `/dev/null`.
 * - **No version and no decimal**: a version dates a box, and `/var/lib/dpkg/status` is
 *   the only thing in the world that states one.
 *
 * Slots: `{place}` the network's organisation or place, `{hostname}` the box's own name.
 */

import type { NetworkCategory } from './essidCatalog';
import type { ServiceSpec } from '../../services/serviceCatalog';

/** Login banners, by the kind of place the network is. Each names the place and the box. */
export const MOTD_TEMPLATES: Readonly<Record<NetworkCategory, readonly string[]>> = {
  corporate: [
    '{hostname} — {place}\n\nThis system is the property of {place}.\nAuthorised use only. Activity on this machine is logged and monitored.\n',
    '*** {place} internal systems ***\nHost: {hostname}\n\nUnauthorised access is prohibited and will be reported.\nRaise a ticket with IT before changing anything on this box.\n',
    'Welcome to {hostname}.\n\n{place} — Information Security reminds you:\n  * lock your screen when you step away\n  * never share your login\n  * report anything unusual to the service desk\n',
    '{place} | {hostname}\n\nChange freeze is in effect every Friday afternoon.\nScheduled maintenance happens Sunday night — save your work.\n',
  ],
  cafe: [
    '{hostname} — {place}\n\nStaff only. If you are a customer, the guest wifi is the other one.\n',
    'Welcome back to {hostname}.\n\n{place}: close the till before you log off,\nand leave a note on the rota if you swap a shift.\n',
    '~ {place} ~\n{hostname}\n\nPlease do not install anything on this machine. It runs the kitchen screens.\n',
    '{hostname} @ {place}\n\nRemember: the milk order goes in before noon on Mondays.\n',
  ],
  residential: [
    '{hostname}\n\nThe {place} house computer. Be nice to it.\n',
    'Hi! You are on {hostname}, at {place}.\n\nDo not turn this off, it is doing the backups.\n',
    '{hostname} — {place}\n\nHomework first, games after.\n',
    'Welcome home to {hostname}.\n{place}\n\nIf the internet is down, restart the router before asking.\n',
  ],
  university: [
    '{hostname} — {place}\n\nThis machine is provided for teaching and research.\nUse is subject to the acceptable use policy of {place}.\n',
    '*** {place} Computing Service ***\n{hostname}\n\nScratch space is wiped weekly. Keep your results somewhere else.\n',
    'Welcome to {hostname}.\n\nLab machines at {place} are shared. Log out when you leave,\nand do not run jobs overnight without booking the machine.\n',
    '{place} | {hostname}\n\nPrinting quota resets at the start of each term.\n',
  ],
  public: [
    '{hostname} — {place}\n\nPublic access terminal. Sessions end after thirty minutes of inactivity.\nDo not leave personal information on this machine.\n',
    'Welcome to {place}.\nYou are on {hostname}.\n\nThis service is provided free of charge. Please be considerate of others.\n',
    '*** {place} ***\n{hostname}\n\nFiles saved here are removed at closing time.\n',
    '{hostname} @ {place}\n\nNeed help? Ask at the front desk.\n',
  ],
  iot: [
    '{hostname}\n{place}\n\nDevice management console. Changes here apply to every connected device.\n',
    'Welcome to {hostname}.\n\nThis controller belongs to {place}.\nDo not power it down during a firmware update.\n',
    '{place} :: {hostname}\n\nFactory settings are restored by holding the reset button for ten seconds.\n',
    '{hostname} — {place}\n\nTelemetry is collected from this device. See the manual for details.\n',
  ],
  hacker: [
    '{hostname}\n\n  there is no spoon\n  -- {place}\n',
    'welcome to {hostname}, friend.\n{place} knows you are here.\n\nbe excellent to each other.\n',
    '[ {place} ]\n[ {hostname} ]\n\nhack the planet. but not this one, it is ours.\n',
    '{hostname} — {place}\n\nif you can read this, you already know too much.\nleave a note in the guestbook on your way out.\n',
  ],
};

/** Housekeeping jobs any box's root might schedule, naming only what every box has. */
export const GENERIC_CRON_JOBS: readonly string[] = [
  'find /tmp -type f -mtime +7 -delete',
  'find /tmp -type d -empty -delete',
  'find /var/log -name "*.log" -size +100M',
  'du -sh /var/log /home /root',
  'sync',
  'apt-get -qq update',
  'apt-get -qq autoclean',
  'journalctl --vacuum-time=2weeks',
  'fstrim -av',
  'updatedb',
  'logger -t cron heartbeat',
  'ntpdate -s pool.ntp.org',
  'find /root -name "*.swp" -delete',
];

/** Jobs that look after one service, scheduled only on a box that runs it. Keyed by the
 *  catalog's service name. */
export const SERVICE_CRON_JOBS: Readonly<Record<ServiceSpec['service'], readonly string[]>> = {
  ssh: ['systemctl is-active sshd', 'find /var/log -name "auth.log*" -mtime +30'],
  http: [
    'find /var/www/html -name "*.tmp" -delete',
    'systemctl reload nginx',
    'du -sh /var/www/html',
  ],
  ftp: ['systemctl is-active vsftpd', 'find /var/log -name "vsftpd.log*" -mtime +30'],
  mysql: ['mysqlcheck --all-databases --auto-repair --silent', 'du -sh /var/lib/mysql'],
  redis: ['redis-cli bgsave', 'du -sh /var/lib/redis'],
  snmp: ['systemctl is-active snmpd'],
  domain: ['systemctl is-active named'],
};

/** Jobs a name server's root schedules against the zone it keeps. Filed by the ROLE rather
 *  than the service, because `/etc/bind` follows the role: a name server whose `named`
 *  is stopped still has its config on disk. */
export const NAME_SERVER_CRON_JOBS: readonly string[] = [
  'named-checkconf /etc/bind/named.conf',
  'find /etc/bind -name "*.jnl" -mtime +7',
];

/** The stock header of Debian's `/etc/crontab`, before any job. */
export const DEBIAN_CRONTAB_HEADER = `# /etc/crontab: system-wide crontab
# Unlike any other crontab you don't have to run the \`crontab'
# command to install the new version when you edit this file
# and files in /etc/cron.d. These files also have username fields,
# that none of the other crontabs do.

SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Example of job definition:
# .---------------- minute (0 - 59)
# |  .------------- hour (0 - 23)
# |  |  .---------- day of month (1 - 31)
# |  |  |  .------- month (1 - 12) OR jan,feb,mar,apr ...
# |  |  |  |  .---- day of week (0 - 6) (Sunday=0 or 7) OR sun,mon,tue,wed,thu,fri,sat
# |  |  |  |  |
# *  *  *  *  * user-name command to be executed
`;

/** The stock header of Debian's `/etc/fstab`, before any mount. */
export const DEBIAN_FSTAB_HEADER = `# /etc/fstab: static file system information.
#
# Use 'blkid' to print the universally unique identifier for a
# device; this may be used with UUID= as a more robust way to name devices
# that works even if disks are added and removed. See fstab(5).
#
# <file system> <mount point>   <type>  <options>       <dump>  <pass>
`;

/** The IPv6 lines every Debian `/etc/hosts` carries. */
export const DEBIAN_HOSTS_IPV6 = `# The following lines are desirable for IPv6 capable hosts
::1     localhost ip6-localhost ip6-loopback
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
`;
