/**
 * What the person who ran a generated box left in `/root`: the stock dotfiles Debian
 * gives root, the commands they typed, and the notes they kept for themselves.
 *
 * The lines here are the half of root's history that does not depend on the box. The
 * other half — the services it restarts, the configs and logs it reads, the neighbours
 * it reached — is generated from the box itself, so it can only name what is there.
 * Rules the tests hold the output to:
 * - **Every path is one every box has**: `/etc/{passwd,hosts,crontab,fstab,resolv.conf,
 *   motd,hostname}`, `/var/log/{auth,kern}.log`, `/var/log`, `/var/run`, `/tmp`, `/home`,
 *   `/root`. Nothing is written to a path the box does not have.
 * - **No network verb** — `ssh`, `curl`, `ping` and `nslookup` lines come from the real
 *   LAN, never from a template.
 * - **No decimal and no password**: a version dates a box, and nothing here is loot.
 *
 * Note slots: `{hostname}` the box's own name, `{place}` the network's organisation or
 * place, `{date}` a past day, `{day}` a weekday, `{count}` a small number. Every note
 * names the box it is on, the way an admin's notes do when they look after several.
 */

import type { DrawnRole } from '../machineRole';

/** `/root/.bashrc`, as Debian ships it for root. */
export const DEBIAN_ROOT_BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.

# Note: PS1 and umask are already set in /etc/profile. You should not
# need this unless you want different defaults for root.
# PS1='\${debian_chroot:+($debian_chroot)}\\h:\\w\\$ '
# umask 022

# You may uncomment the following lines if you want \`ls' to be colorized:
# export LS_OPTIONS='--color=auto'
# eval "$(dircolors)"
# alias ls='ls $LS_OPTIONS'
# alias ll='ls $LS_OPTIONS -l'
# alias l='ls $LS_OPTIONS -lA'
#
# Some more alias to avoid making mistakes:
# alias rm='rm -i'
# alias cp='cp -i'
# alias mv='mv -i'
`;

/** `/root/.profile`, as Debian ships it for root. */
export const DEBIAN_ROOT_PROFILE = `# ~/.profile: executed by Bourne-compatible login shells.

if [ "$BASH" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
fi

mesg n 2> /dev/null || true
`;

/** Commands any box's admin types, whatever the box is for. */
export const ROOT_HISTORY: readonly string[] = [
  'apt update',
  'apt upgrade -y',
  'apt autoremove',
  'apt list --upgradable',
  'df -h',
  'du -sh /var/log',
  'du -sh /home',
  'free -m',
  'uptime',
  'top',
  'htop',
  'ps aux',
  'ss -tlnp',
  'netstat -tlnp',
  'ip a',
  'ip route',
  'ifconfig',
  'ls -la /var/log',
  'tail /var/log/auth.log',
  'tail -f /var/log/auth.log',
  'grep Failed /var/log/auth.log',
  'grep -c sshd /var/log/auth.log',
  'less /var/log/kern.log',
  'last',
  'w',
  'who',
  'cat /etc/passwd',
  'vim /etc/hosts',
  'cat /etc/hosts',
  'nano /etc/crontab',
  'cat /etc/crontab',
  'cat /etc/fstab',
  'cat /etc/resolv.conf',
  'vim /etc/motd',
  'cat /etc/hostname',
  'ls /home',
  'ls -la /root',
  'cd /tmp',
  'ls -la /tmp',
  'ls /var/run',
  'journalctl -xe',
  'dmesg | tail',
  'lsblk',
  'mount',
  'crontab -l',
  'iptables -L -n',
  'ufw status',
  'timedatectl',
  'hostnamectl',
  'uname -a',
  'history',
  'reboot',
  'exit',
  'clear',
];

/** Commands flavoured by what the box is for — still local, still naming only paths
 *  every box of that role has. Keyed by role; a box whose name claims no role gets none
 *  of these. */
export const ROLE_ROOT_HISTORY: Readonly<Record<DrawnRole, readonly string[]>> = {
  workstation: [
    'apt install htop',
    'adduser --help',
    'lsmod',
    'lsusb',
    'lspci',
    'xrandr',
    'fwupdmgr get-updates',
  ],
  iot: [
    'lscpu',
    'vcgencmd measure_temp',
    'i2cdetect -y 1',
    'journalctl -b',
    'sync',
    'watchdog -v',
    'ls /var/run',
  ],
  webserver: [
    'certbot renew --dry-run',
    'certbot certificates',
    'openssl version -d',
    'logrotate --help',
    'goaccess --help',
    'ls -la /var/log',
    'nginx -t',
  ],
  // A file server here shares over ftp alone and keeps its share on the disk mounted at
  // /srv, so its admin names no samba, nfs or zfs.
  fileserver: [
    'du -sh /srv',
    'df -h /srv',
    'rsync --help',
    'smartctl --scan',
    'du -sh /home',
    'findmnt /srv',
    'ls -l /srv',
  ],
  database: [
    'mysql -u root',
    'mysqladmin status',
    'mysqladmin processlist',
    'mysqltuner',
    'free -m',
    'iostat -x 5',
    'vmstat 5',
  ],
  mailserver: [
    'mailq',
    'postqueue -p',
    'postsuper -d ALL deferred',
    'postconf -n',
    'doveadm who',
    'grep reject /var/log/auth.log',
    'newaliases',
  ],
  dns: [
    'rndc reload',
    'rndc status',
    'rndc zonestatus',
    'named-checkconf',
    'rndc flush',
    'journalctl -u named',
    'rndc querylog',
  ],
};

export type RootNoteTemplate = { readonly file: string; readonly body: string };

/** Notes an admin keeps in `/root`. File names are unique, so two notes in one `/root`
 *  never collide. */
export const ROOT_NOTE_TEMPLATES: readonly RootNoteTemplate[] = [
  {
    file: 'TODO',
    body: '{hostname}\n- rotate the logs before the disk fills again\n- check the backup job actually ran\n- tidy /tmp\n(last looked at {date})\n',
  },
  {
    file: 'handover.txt',
    body: 'Handover for {hostname}, {date}\n\nNothing on fire. Reboot is safe outside hours.\nIf it hangs on boot, give it {count} minutes before touching anything.\n',
  },
  {
    file: 'README.admin',
    body: 'This box ({hostname}) belongs to {place}.\nAsk before installing anything. Changes go in the log below.\n\n{date}  initial setup\n',
  },
  {
    file: 'disk.txt',
    body: '{hostname} disk usage keeps creeping up.\n{date}: cleared old logs, freed a bit.\nCheck again every {day}.\n',
  },
  {
    file: 'incident.txt',
    body: '{date} — {hostname} stopped answering around lunchtime.\nCause: ran out of memory. Restarted services, all fine after {count} minutes.\nKeep an eye on it.\n',
  },
  {
    file: 'changes.log',
    body: '{date}  {hostname}: applied updates, rebooted\n{date}  {hostname}: tightened ssh, root login by key only\n',
  },
  {
    file: 'migration.txt',
    body: 'Plan to move {hostname} to new hardware.\nTarget: before the end of the quarter. {place} signed off on {date}.\nNeed {count} hours of downtime, ask for a {day} evening.\n',
  },
  {
    file: 'firewall.txt',
    body: 'Firewall on {hostname}\n- allow what the box serves, drop the rest\n- reviewed {date}\n- review again in {count} months\n',
  },
  {
    file: 'reminders.txt',
    body: '{hostname}\n* patch day is {day}\n* do not reboot during {place} opening hours\n* last patched {date}\n',
  },
  {
    file: 'why-is-this-slow.txt',
    body: '{hostname} crawled again on {date}.\nLoad average went past {count}. Nothing obvious in the logs.\nSuspect the backup job overlapping with something.\n',
  },
  {
    file: 'setup-notes.txt',
    body: 'Setting up {hostname} for {place}, {date}\n1. install base packages\n2. harden ssh\n3. set up the cron jobs\n4. write the motd\n',
  },
  {
    file: 'audit.txt',
    body: 'Account audit on {hostname}, {date}\nRemoved {count} old logins nobody uses.\nNext audit: some {day}, when things are quiet.\n',
  },
];
