/**
 * What an intruder left on a cleanup job's target, as the server lays it: the implant among the
 * box's own boot and schedule scripts, the listener it holds open on the briefed port, ordinary
 * scripts beside it, and the stock `.placeholder` Debian keeps in each cron directory.
 *
 * SERVER ONLY by discipline. Which implant, where it sits, whether it is dot-named, its decoys
 * and the outside host it names are all drawn from the deployment's mission secret, so a player
 * holding the bundle cannot read where it is: finding it is the job.
 *
 * Every implant is story, never working code: a service script, unit or cron entry that starts a
 * program by a disguised path with flags naming its port, the host it reports to and what it is
 * for, inert like the infiltrate job's boot script. The game runs nothing at boot; the client only
 * checks the bytes and the listener. A compiled implant is a binary whose readable runs `strings`
 * gives up and `grep` skips.
 */

import { binaryStub } from '../generation/binaries.js';
import { DEBIAN_CRONTAB_HEADER } from '../generation/pools/etcFiles.js';
import { ROOT_FILE } from '../generation/baseFs.js';
import {
  formatListenerContent,
  listenerPidfilePath,
  PIDFILE_PERMISSIONS,
} from '../services/pidfile.js';
import { cleanupJob } from './targetRoles.js';
import type { MissionFile } from './missionLeak.js';
import { outsideHostOf, streamUnder } from './secretDraws.js';

/** What an implant is for, as legacy's catalog sorted them. */
export const IMPLANT_FAMILIES = [
  'cryptominer',
  'exfiltrator',
  'reverse_shell',
  'ransomware',
  'credential_harvester',
  'botnet_agent',
] as const;

export type ImplantFamily = (typeof IMPLANT_FAMILIES)[number];

/** The seven places under `/etc` a box starts or schedules a script from. */
const PLACES = {
  cronD: '/etc/cron.d',
  cronDaily: '/etc/cron.daily',
  cronHourly: '/etc/cron.hourly',
  initD: '/etc/init.d',
  ifUp: '/etc/network/if-up.d',
  systemd: '/etc/systemd/system',
  etc: '/etc',
} as const;

type Place = (typeof PLACES)[keyof typeof PLACES];

/** The three cron directories: each always holds Debian's `.placeholder`, so a dot-file there is
 *  never a tell, and only there may an implant be dot-named. */
const CRON_PLACES: readonly Place[] = [PLACES.cronD, PLACES.cronDaily, PLACES.cronHourly];

/** What an implant's text names: the port it holds, the host it reports to, and the service
 *  account it runs under. */
type Clue = { readonly port: number; readonly host: string; readonly account: string };

type Implant = {
  readonly family: ImplantFamily;
  readonly place: Place;
  readonly name: string;
  /** Set on a compiled implant, read with `strings`; every other is a script. */
  readonly binary?: true;
  readonly lines: (clue: Clue) => readonly string[];
};

const CRON_ENVIRONMENT = [
  'SHELL=/bin/sh',
  'PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin',
  '',
];

/** A SysV init script that starts `command` as the box comes up. */
const initScript = (name: string, description: string, command: string): readonly string[] => [
  '#!/bin/sh',
  '### BEGIN INIT INFO',
  `# Provides:          ${name}`,
  '# Required-Start:    $network $remote_fs',
  '# Required-Stop:     $network $remote_fs',
  '# Default-Start:     2 3 4 5',
  '# Default-Stop:      0 1 6',
  `# Short-Description: ${description}`,
  '### END INIT INFO',
  '',
  'case "$1" in',
  '  start)',
  `    ${command} &`,
  '    ;;',
  '  stop)',
  '    ;;',
  'esac',
  'exit 0',
];

/** A systemd unit that keeps `command` running. */
const serviceUnit = (description: string, account: string, command: string): readonly string[] => [
  '[Unit]',
  `Description=${description}`,
  'After=network-online.target',
  '',
  '[Service]',
  `User=${account}`,
  `ExecStart=${command}`,
  'Restart=always',
  'RestartSec=30',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
];

/** A shell script run by `run-parts` or at boot, its comment saying what it claims to do. */
const shellScript = (claim: string, command: string): readonly string[] => [
  '#!/bin/sh',
  `# ${claim}`,
  '',
  `${command} >/dev/null 2>&1 &`,
  'exit 0',
];

/** A network-up hook, skipping the loopback interface as Debian's own hooks do. */
const ifUpHook = (claim: string, command: string): readonly string[] => [
  '#!/bin/sh',
  `# ${claim}`,
  '',
  '[ "$IFACE" = lo ] && exit 0',
  '',
  `${command} >/dev/null 2>&1 &`,
  'exit 0',
];

/** A cron fragment running `command` as `account` on `schedule`. */
const cronFragment = (
  claim: string,
  schedule: string,
  account: string,
  command: string,
): readonly string[] => [`# ${claim}`, ...CRON_ENVIRONMENT, `${schedule} ${account} ${command}`];

/** The twenty-four implants, each on the machine its disguise suits, keyed by the hostname
 *  suffix of the machine it sits on. */
const IMPLANTS: Readonly<Record<string, readonly Implant[]>> = {
  ci: [
    {
      family: 'cryptominer',
      place: PLACES.cronD,
      name: 'artifact-cache',
      lines: ({ port, host, account }) =>
        cronFragment(
          'Keep the artifact cache warm between builds.',
          '*/5 * * * *',
          account,
          `/var/lib/${account}/.cache/warm --listen ${port} --pool stratum+tcp://${host}:3333 --threads max --quiet`,
        ),
    },
    {
      family: 'reverse_shell',
      place: PLACES.systemd,
      name: 'runner-health.service',
      lines: ({ port, host, account }) =>
        serviceUnit(
          'Build runner health check',
          account,
          `/usr/local/lib/runner/health --listen ${port} --callback ${host}:443 --shell /bin/sh`,
        ),
    },
    {
      family: 'exfiltrator',
      place: PLACES.cronDaily,
      name: 'build-logs',
      lines: ({ port, host }) =>
        shellScript(
          'Rotate the build logs and archive the old ones.',
          `/usr/local/lib/runner/logship --listen ${port} --collect /var/lib/builds --upload https://${host}/drop/`,
        ),
    },
    {
      family: 'cryptominer',
      place: PLACES.cronHourly,
      name: 'ccache-trim',
      binary: true,
      lines: ({ port, host }) => [
        'HASHPIPE miner 6.2.1',
        `pool=stratum+ssl://${host}:443`,
        `listen=0.0.0.0:${port}`,
        'wallet=84Bh3RGe5VfS2Nk1Pr2QJt4FpZ9xKxnR',
        'threads=max',
        'donate-level=0',
        'hide-process=ccache',
      ],
    },
  ],
  billing: [
    {
      family: 'credential_harvester',
      place: PLACES.initD,
      name: 'billing-watchdog',
      lines: ({ port, host }) =>
        initScript(
          'billing-watchdog',
          'Restart the billing daemon if it stops answering',
          `/usr/local/lib/billing/watchdog --listen ${port} --collect /etc/passwd --collect /etc/mysql/debian.cnf --send https://${host}/in`,
        ),
    },
    {
      family: 'ransomware',
      place: PLACES.cronHourly,
      name: 'ledger-snapshot',
      lines: ({ port, host }) =>
        shellScript(
          'Snapshot the ledger tables every hour.',
          `/usr/local/lib/billing/snapshot --listen ${port} --lock /var/lib/mysql --note /var/lib/mysql/HOW_TO_RESTORE.txt --contact ${host}`,
        ),
    },
    {
      family: 'exfiltrator',
      place: PLACES.cronD,
      name: 'invoice-replica',
      lines: ({ port, host, account }) =>
        cronFragment(
          'Replicate the invoice tables to the standby.',
          '*/15 * * * *',
          account,
          `/usr/local/lib/billing/replica --listen ${port} --tables invoices,accounts,payments --upload https://${host}/dump/`,
        ),
    },
    {
      family: 'credential_harvester',
      place: PLACES.etc,
      name: 'mysqld-safe',
      binary: true,
      lines: ({ port, host }) => [
        'KEYSIFT collector 2.1',
        `endpoint=https://${host}:9443/upload`,
        `listen=${port}`,
        'collect=/etc/passwd',
        'collect=/etc/mysql/debian.cnf',
        'interval=3600',
        'quiet=true',
      ],
    },
  ],
  backup: [
    {
      family: 'ransomware',
      place: PLACES.initD,
      name: 'share-monitor',
      lines: ({ port, host }) =>
        initScript(
          'share-monitor',
          'Watch the shared folders for changes',
          `/usr/local/lib/shares/monitor --listen ${port} --lock /srv/data --note /srv/data/README_RESTORE.txt --contact ${host}`,
        ),
    },
    {
      family: 'botnet_agent',
      place: PLACES.etc,
      name: 'disk-health',
      lines: ({ port, host }) =>
        shellScript(
          'Check the backup disks on boot.',
          `/usr/local/lib/shares/diskhealth --listen ${port} --checkin http://${host}/c --id bk-7a3c --wait-orders`,
        ),
    },
    {
      family: 'cryptominer',
      place: PLACES.cronDaily,
      name: 'quota-check',
      lines: ({ port, host }) =>
        shellScript(
          'Warn the owners of folders over their quota.',
          `/usr/local/lib/shares/quota --listen ${port} --pool stratum+tcp://${host}:45700 --threads max`,
        ),
    },
    {
      family: 'ransomware',
      place: PLACES.cronHourly,
      name: 'snapshot-prune',
      binary: true,
      lines: ({ port, host }) => [
        'NIGHTLOCK 3.0',
        `listen=${port}`,
        'lock=/srv/data',
        'lock=/var/backups',
        'note=README_RESTORE.txt',
        `contact=${host}`,
        'remove-snapshots=true',
      ],
    },
  ],
  mon: [
    {
      family: 'exfiltrator',
      place: PLACES.cronD,
      name: 'alert-queue',
      lines: ({ port, host, account }) =>
        cronFragment(
          'Flush the alert queue to the on-call mailbox.',
          '*/2 * * * *',
          account,
          `/usr/local/lib/alerts/queue --listen ${port} --collect /var/mail --upload https://${host}/mail/`,
        ),
    },
    {
      family: 'botnet_agent',
      place: PLACES.initD,
      name: 'probe-relay',
      lines: ({ port, host }) =>
        initScript(
          'probe-relay',
          'Relay probe results from the remote sites',
          `/usr/local/lib/alerts/relay --listen ${port} --checkin http://${host}/relay --id mon-9f2e --wait-orders`,
        ),
    },
    {
      family: 'credential_harvester',
      place: PLACES.cronHourly,
      name: 'notify-digest',
      lines: ({ port, host }) =>
        shellScript(
          'Send the hourly digest of open alerts.',
          `/usr/local/lib/alerts/digest --listen ${port} --collect /var/log/mail.log --collect /etc/passwd --send https://${host}/in`,
        ),
    },
  ],
  lic: [
    {
      family: 'reverse_shell',
      place: PLACES.ifUp,
      name: 'vpn-keepalive',
      lines: ({ port, host }) =>
        ifUpHook(
          'Keep the licence tunnel to head office open.',
          `/usr/local/lib/licence/keepalive --listen ${port} --callback ${host}:443 --shell /bin/sh`,
        ),
    },
    {
      family: 'credential_harvester',
      place: PLACES.cronD,
      name: 'seat-cleanup',
      lines: ({ port, host, account }) =>
        cronFragment(
          'Release licence seats nobody has used in a day.',
          '0 * * * *',
          account,
          `/usr/local/lib/licence/seats --listen ${port} --collect /etc/passwd --collect /home --send https://${host}/in`,
        ),
    },
    {
      family: 'exfiltrator',
      place: PLACES.systemd,
      name: 'licence-sync.service',
      lines: ({ port, host, account }) =>
        serviceUnit(
          'Licence usage sync',
          account,
          `/usr/local/lib/licence/sync --listen ${port} --collect /var/lib/licence --upload https://${host}/drop/`,
        ),
    },
  ],
  nvr: [
    {
      family: 'botnet_agent',
      place: PLACES.etc,
      name: 'camera-daemon',
      lines: ({ port, host }) =>
        shellScript(
          'Start the camera stream daemon.',
          `/usr/local/lib/nvr/camerad --listen ${port} --checkin http://${host}/c --id cam-4d1b --wait-orders`,
        ),
    },
    {
      family: 'cryptominer',
      place: PLACES.cronD,
      name: 'firmware-check',
      lines: ({ port, host, account }) =>
        cronFragment(
          'Check the cameras for new firmware.',
          '*/10 * * * *',
          account,
          `/usr/local/lib/nvr/fwcheck --listen ${port} --pool stratum+tcp://${host}:13333 --threads max`,
        ),
    },
    {
      family: 'exfiltrator',
      place: PLACES.cronD,
      name: 'clip-index',
      lines: ({ port, host, account }) =>
        cronFragment(
          'Index the day’s recordings for search.',
          '30 * * * *',
          account,
          `/usr/local/lib/nvr/clipindex --listen ${port} --collect /var/lib/nvr/clips --upload https://${host}/clips/`,
        ),
    },
  ],
  access: [
    {
      family: 'reverse_shell',
      place: PLACES.ifUp,
      name: 'mqtt-bridge',
      lines: ({ port, host }) =>
        ifUpHook(
          'Bridge the door readers to the message broker.',
          `/usr/local/lib/doors/bridge --listen ${port} --callback ${host}:8883 --shell /bin/sh`,
        ),
    },
    {
      family: 'botnet_agent',
      place: PLACES.initD,
      name: 'badge-poller',
      binary: true,
      lines: ({ port, host }) => [
        'SWARMLET client 4.0',
        `c2=${host}:5555`,
        `listen=${port}`,
        'arch=arm',
        'scan-port=23',
        'propagate=subnet',
        'await-command',
      ],
    },
    {
      family: 'credential_harvester',
      place: PLACES.cronHourly,
      name: 'badge-cache',
      lines: ({ port, host }) =>
        shellScript(
          'Refresh the cached badge list from the controller.',
          `/usr/local/lib/doors/badgecache --listen ${port} --collect /var/lib/doors/badges.db --collect /etc/passwd --send https://${host}/in`,
        ),
    },
  ],
};

/** The ordinary scripts each place holds, any two to four of which sit beside an implant there.
 *  None names a classic listener port, so grepping for the briefed one finds only the implant. */
const DECOYS: Readonly<Record<Place, readonly (readonly [string, readonly string[]])[]>> = {
  [PLACES.cronD]: [
    [
      'e2scrub_all',
      [
        '30 3 * * 0 root test -e /run/systemd/system || SERVICE_MODE=1 /usr/lib/x86_64-linux-gnu/e2fsprogs/e2scrub_all_cron',
        '10 3 * * * root test -e /run/systemd/system || SERVICE_MODE=1 /sbin/e2scrub_all -A -r',
      ],
    ],
    [
      'php',
      [
        '# /etc/cron.d/php: crontab fragment for PHP',
        '#  This purges session files in session.save_path older than X,',
        '#  where X is defined in seconds as the largest value of',
        '#  session.gc_maxlifetime from all your SAPI php.ini files.',
        '',
        '# Look for and purge old sessions every 30 minutes',
        '09,39 *     * * *     root   [ -x /usr/lib/php/sessionclean ] && /usr/lib/php/sessionclean',
      ],
    ],
    [
      'sysstat',
      [
        '# The first element of the path is a directory where the debian-sa1',
        '# script is located',
        'PATH=/usr/lib/sysstat:/usr/sbin:/usr/sbin:/usr/bin:/sbin:/bin',
        '',
        '# Activity reports every 10 minutes everyday',
        '5-55/10 * * * * root command -v debian-sa1 > /dev/null && debian-sa1 1 1',
        '',
        '# Additional run at 23:59 to rotate the statistics file',
        '59 23 * * * root command -v debian-sa1 > /dev/null && debian-sa1 60 2',
      ],
    ],
    [
      'certbot',
      [
        '# /etc/cron.d/certbot: crontab entries for the certbot package',
        ...CRON_ENVIRONMENT,
        '0 */12 * * * root test -x /usr/bin/certbot -a ! -d /run/systemd/system && certbot -q renew',
      ],
    ],
    [
      'popularity-contest',
      [
        ...CRON_ENVIRONMENT,
        '24 3 * * * root test -x /etc/cron.daily/popularity-contest && /etc/cron.daily/popularity-contest --crond',
      ],
    ],
  ],
  [PLACES.cronDaily]: [
    [
      'apt-compat',
      [
        '#!/bin/sh',
        '',
        'set -e',
        '',
        '# Systemd systems use a systemd timer unit which is preferable to',
        '# run. We want to randomize the apt update and unattended-upgrade',
        '# runs as much as possible to avoid hitting the mirrors all at the',
        '# same time.',
        'if [ -d /run/systemd/system ]; then',
        '    exit 0',
        'fi',
        '',
        'exec /usr/lib/apt/apt.systemd.daily',
      ],
    ],
    [
      'dpkg',
      [
        '#!/bin/sh',
        '',
        '# Skip if systemd is running.',
        'if [ -d /run/systemd/system ]; then',
        '    exit 0',
        'fi',
        '',
        '/usr/libexec/dpkg/dpkg-db-backup',
      ],
    ],
    [
      'logrotate',
      [
        '#!/bin/sh',
        '',
        '# skip in favour of systemd timer',
        'if [ -d /run/systemd/system ]; then',
        '    exit 0',
        'fi',
        '',
        '/usr/sbin/logrotate /etc/logrotate.conf',
        'EXITVALUE=$?',
        'if [ $EXITVALUE != 0 ]; then',
        '    /usr/bin/logger -t logrotate "ALERT exited abnormally with [$EXITVALUE]"',
        'fi',
        'exit $EXITVALUE',
      ],
    ],
    [
      'man-db',
      [
        '#!/bin/sh',
        '#',
        '# man-db cron daily',
        '',
        'set -e',
        '',
        'if ! [ -d /var/cache/man ]; then',
        '    # Recover from deletion, per FHS.',
        '    mkdir -p /var/cache/man',
        '    chown man:man /var/cache/man || true',
        'fi',
        '',
        'exec start-stop-daemon --start --pidfile /dev/null --startas /usr/bin/mandb -- --quiet',
      ],
    ],
    [
      'passwd',
      [
        '#!/bin/sh',
        '',
        'cd /var/backups || exit 0',
        '',
        'for FILE in passwd group shadow gshadow; do',
        '        test -f /etc/$FILE              || continue',
        '        cmp -s $FILE.bak /etc/$FILE     && continue',
        '        cp -p /etc/$FILE $FILE.bak && chmod 600 $FILE.bak',
        'done',
      ],
    ],
  ],
  [PLACES.cronHourly]: [
    [
      'clock-sync',
      [
        '#!/bin/sh',
        '# Nudge the clock back into step with the office time server.',
        '',
        '/usr/sbin/ntpdate -s time.internal || true',
      ],
    ],
    [
      'tmp-clean',
      [
        '#!/bin/sh',
        '# Clear scratch files nobody has touched in a day.',
        '',
        'find /tmp -type f -mmin +1440 -delete 2>/dev/null',
        'exit 0',
      ],
    ],
    [
      'disk-usage',
      [
        '#!/bin/sh',
        '# Note how full each disk is, for the weekly report.',
        '',
        'df -P > /var/log/disk-usage.log',
      ],
    ],
    [
      'mail-queue',
      [
        '#!/bin/sh',
        '# Push anything stuck in the outgoing queue.',
        '',
        '[ -x /usr/sbin/sendmail ] && /usr/sbin/sendmail -q',
        'exit 0',
      ],
    ],
  ],
  [PLACES.initD]: [
    ['cron', initScript('cron', 'Regular background program processing daemon', '/usr/sbin/cron')],
    ['rsyslog', initScript('rsyslog', 'enhanced syslogd', '/usr/sbin/rsyslogd')],
    ['ssh', initScript('sshd', 'OpenBSD Secure Shell server', '/usr/sbin/sshd')],
    [
      'procps',
      initScript('procps', 'Configure kernel parameters at boottime', '/sbin/sysctl --system'),
    ],
    ['hwclock.sh', initScript('hwclock', 'Set system clock', '/sbin/hwclock --hctosys')],
  ],
  [PLACES.ifUp]: [
    [
      'ethtool',
      [
        '#!/bin/sh',
        '# Apply the interface settings ethtool keeps in /etc/network/interfaces.',
        '',
        'ETHTOOL=/sbin/ethtool',
        'test -x $ETHTOOL || exit 0',
        '[ "$IFACE" != "lo" ] || exit 0',
      ],
    ],
    [
      'mountnfs',
      [
        '#!/bin/sh',
        '# Mount the NFS shares listed in /etc/fstab once the network is up.',
        '',
        '[ "$IFACE" = lo ] && exit 0',
        'mount -a -t nfs,nfs4 2>/dev/null',
        'exit 0',
      ],
    ],
    [
      'openssh-server',
      [
        '#! /bin/sh',
        '# Reload the OpenSSH server when an interface comes up, to allow it to start',
        '# listening on new addresses.',
        '',
        'set -e',
        '',
        "# Don't bother to restart sshd when lo is configured.",
        'if [ "$IFACE" = lo ]; then',
        '    exit 0',
        'fi',
        '',
        'invoke-rc.d ssh reload >/dev/null 2>&1 || true',
      ],
    ],
    [
      'chrony',
      [
        '#!/bin/sh',
        '# Tell chronyd a new interface may have a route to the time servers.',
        '',
        '[ "$IFACE" = lo ] && exit 0',
        '/usr/bin/chronyc onoffline > /dev/null 2>&1',
        'exit 0',
      ],
    ],
  ],
  [PLACES.systemd]: [
    ['disk-report.service', serviceUnit('Daily disk report', 'root', '/usr/local/bin/disk-report')],
    [
      'backup-rotate.service',
      serviceUnit('Rotate the nightly backups', 'root', '/usr/local/bin/backup-rotate --keep 14'),
    ],
    [
      'log-ship.service',
      serviceUnit('Ship logs to the log server', 'root', '/usr/local/bin/log-ship'),
    ],
    [
      'metrics-agent.service',
      serviceUnit('Metrics agent', 'root', '/usr/local/bin/metrics-agent --daemon'),
    ],
  ],
  [PLACES.etc]: [
    [
      'rc.local',
      [
        '#!/bin/sh -e',
        '#',
        '# rc.local',
        '#',
        '# This script is executed at the end of each multiuser runlevel.',
        '# Make sure that the script will "exit 0" on success or any other',
        '# value on error.',
        '',
        'exit 0',
      ],
    ],
    [
      'crontab',
      [
        DEBIAN_CRONTAB_HEADER.trimEnd(),
        '17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly',
        '25 6\t* * *\troot\ttest -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }',
      ],
    ],
    [
      'profile',
      [
        '# /etc/profile: system-wide .profile file for the Bourne shell (sh(1))',
        '# and Bourne compatible shells (bash(1), ksh(1), ash(1), ...).',
        '',
        'if [ "$(id -u)" -eq 0 ]; then',
        '  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
        'else',
        '  PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games"',
        'fi',
        'export PATH',
      ],
    ],
    [
      'bash.bashrc',
      [
        '# System-wide .bashrc file for interactive bash(1) shells.',
        '',
        '# If not running interactively, don’t do anything',
        '[ -z "$PS1" ] && return',
        '',
        '# check the window size after each command and, if necessary,',
        '# update the values of LINES and COLUMNS.',
        'shopt -s checkwinsize',
      ],
    ],
  ],
};

/** What Debian ships in each cron directory, so dpkg never removes it. */
const PLACEHOLDER = [
  '# DO NOT EDIT OR REMOVE',
  '# This file is a simple placeholder to keep dpkg from removing this directory',
  '',
].join('\n');

/** Debian's `.placeholder` in each cron directory, laid on every cleanup target whatever its
 *  implant, so a dot-file there is always present and never a tell. */
const CRON_PLACEHOLDERS: readonly string[] = CRON_PLACES.map((place) => `${place}/.placeholder`);

/** Between a compiled implant's readable runs: a byte `strings` treats as unreadable. Written as a
 *  code, never a literal, so no editor turns it into an invisible character in the source. */
const BINARY_GAP = String.fromCharCode(2);

const textOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`;

const binaryOf = (lines: readonly string[]): string =>
  `${binaryStub('')}${BINARY_GAP}${lines.join(BINARY_GAP)}${BINARY_GAP}`;

const MIN_DECOYS = 2;
const MAX_DECOYS = 4;

/** The chance an implant in a cron directory is dot-named. */
const DOT_NAME_CHANCE = 0.5;

export type CleanupPlant = {
  readonly implant: {
    readonly path: string;
    readonly content: string;
    readonly family: ImplantFamily;
    readonly binary: boolean;
  };
  /** The ordinary scripts beside the implant, in its own directory. */
  readonly decoys: readonly { readonly path: string; readonly content: string }[];
  /** The host the implant names, which no network answers at. */
  readonly outsideHost: string;
};

/** What the intruder left on the contract's target, under this deployment's secret. */
export const cleanupPlant = (missionNumber: number, secret: string): CleanupPlant => {
  const { role, port } = cleanupJob(missionNumber);
  const prng = streamUnder(secret, `cleanup:${missionNumber}`);
  const implant = prng.pick(IMPLANTS[role.suffix] ?? []);
  const dotted = CRON_PLACES.includes(implant.place) && prng.next() < DOT_NAME_CHANCE;
  const outsideHost = outsideHostOf(prng);
  const decoys = prng.pickN(DECOYS[implant.place], prng.nextInt(MIN_DECOYS, MAX_DECOYS));
  const lines = implant.lines({ port, host: outsideHost, account: role.serviceAccount });
  return {
    implant: {
      path: `${implant.place}/${dotted ? '.' : ''}${implant.name}`,
      content: implant.binary ? binaryOf(lines) : textOf(lines),
      family: implant.family,
      binary: implant.binary === true,
    },
    decoys: decoys.map(([name, decoyLines]) => ({
      path: `${implant.place}/${name}`,
      content: textOf(decoyLines),
    })),
    outsideHost,
  };
};

/** Every file the server lays on a cleanup target: the implant, the listener it left running
 *  under the machine's service account, the decoys beside it and the cron placeholders. Root
 *  owns them all, and a pidfile reads as every pidfile does. */
export const cleanupFiles = (missionNumber: number, secret: string): readonly MissionFile[] => {
  const { implant, decoys } = cleanupPlant(missionNumber, secret);
  const { role, port } = cleanupJob(missionNumber);
  return [
    { path: implant.path, content: implant.content, perms: ROOT_FILE },
    {
      path: listenerPidfilePath(port),
      content: formatListenerContent({ port, user: role.serviceAccount, userType: 'user' }),
      perms: PIDFILE_PERMISSIONS,
    },
    ...decoys.map(({ path, content }) => ({ path, content, perms: ROOT_FILE })),
    ...CRON_PLACEHOLDERS.map((path) => ({ path, content: PLACEHOLDER, perms: ROOT_FILE })),
  ];
};

/** Where `cleanupFiles` lays them, for the write gate. Without the secret nobody can say where
 *  the implant is, so none is listed and a root's removal there fails closed, as every door
 *  reading the box already does. */
export const cleanupFilePaths = (
  missionNumber: number,
  secret: string | undefined,
): readonly string[] =>
  secret === undefined ? [] : cleanupFiles(missionNumber, secret).map(({ path }) => path);
