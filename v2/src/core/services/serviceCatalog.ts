/**
 * SERVICE_CATALOG — the single declarative home for every network service the
 * world knows about. Ported in spirit from legacy `INFRA_PID_CONFIGS`.
 *
 * Adding a service is ONE row; tuning a knob is ONE number. The `sshd` command
 * (writer), the generator (planter), and the pidfile readers (`nmap`, `ssh`,
 * `ps`) all read from here, so the pidfile name/port stays DRY — one description,
 * many consumers.
 *
 * Discipline (don't gold-plate): ROWS arrive when a service ships, COLUMNS when
 * something consumes them — the generation knobs (`placement`, `altPorts`,
 * `altPortChance`) landed with the per-host FS generator that reads them.
 * CVE/version columns come with the epic that needs them, never speculatively.
 */

import type { AbsPath } from '../types';
import type { Directory, FilePermissions } from '../filesystem/types';
import { accountsIn } from '../sessions/passwdAccount';
import { databaseAccountsIn } from '../mysql/datadir';
import type { SweepableAccount } from '../wordlist/passwordSweep';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
  type CredentialAttempt,
} from '../logging/authLog';
import {
  VSFTPD_LOG_OWNER,
  VSFTPD_LOG_PATH,
  VSFTPD_LOG_PERMISSIONS,
  formatVsftpdConnectLine,
  formatVsftpdLoginLine,
} from '../logging/vsftpdLog';
import {
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
  formatMysqlAttemptLine,
} from '../logging/mysqlLog';

/** Where a credential sweep against this service is recorded on the target, and how
 *  each attempt is written there.
 *
 *  Routing by service is what keeps the wall of failures and the break-in that
 *  followed in ONE file. Sent to a fixed destination instead, a sweep against one
 *  daemon is filed under another — telling the defender a door was knocked on that
 *  never was, while the door that opened shows nothing. */
export type SweepLog = {
  readonly path: AbsPath;
  readonly owner: string;
  readonly permissions: FilePermissions;
  readonly formatAttempt: (attempt: CredentialAttempt) => string;
  /** How the daemon records a client REACHING it, before any account is named.
   *  Absent for daemons that record no such thing: sshd's first line is already the
   *  attempt, so an arrival line there would be an invention. */
  readonly formatArrival?: (
    arrival: Pick<CredentialAttempt, 'fromIp' | 'time' | 'pid'>,
  ) => string;
};

export type ServiceSpec = {
  /** The label `nmap` prints in the SERVICE column (e.g. `ssh`). */
  readonly service: string;
  /** The `/var/run/<pidfile>` name; its basename is the daemon written into the
   *  pidfile line (`sshd.pid` → `sshd:port=22`). */
  readonly pidfile: string;
  /** The port the daemon listens on absent an explicit override. */
  readonly defaultPort: number;
  /** The account the daemon runs as — the pidfile's owner. */
  readonly runUser: string;
  /** What the daemon says to a client that opens a raw connection — the greeting
   *  `nc` prints, and the only way a port identifies itself in its own words.
   *
   *  DELIBERATELY VERSION-FREE. A protocol identifier (`SSH-2.0`, `HTTP/1.1`) is
   *  fine; a build (`OpenSSH_8.9p1`) is not. Versions are the package manifest's
   *  to tell — `/var/lib/dpkg/status` is where a version scan reads them — and a
   *  version baked in here would be a second, contradicting source of truth for
   *  the fact vulnerabilities are keyed on. */
  readonly banner: string;
  /** The fraction of hosts that run this service across the world at large. Each
   *  host rolls independently — no per-LAN guarantee.
   *
   *  This is the rate for a box with nothing particular to say about the service.
   *  What a box is FOR can raise or lower it (a webserver nearly always publishes;
   *  a camera seldom offers a shell) — see `rolePlacement`. */
  readonly placement: number;
  /** Non-standard ports the service sometimes listens on. Empty ⇒ always
   *  `defaultPort`. */
  readonly altPorts: readonly number[];
  /** The chance a generated host uses an `altPorts` entry instead of
   *  `defaultPort`. */
  readonly altPortChance: number;
  /** Where a wordlist attack on this service lands in the target's logs. */
  readonly sweepLog: SweepLog;
  /** Which of a box's accounts this door authenticates, and so which ones a sweep of
   *  it attacks.
   *
   *  Nearly every door answers to the box's own `/etc/passwd`; the database door is
   *  the exception. Keeping the answer on the ROW is what stops each sweep handler
   *  from guessing: read from a fixed file instead, a sweep of one door reports the
   *  accounts of another — the right names against the wrong secrets, which reads to
   *  a player as a working credential right up until they use it. */
  readonly accountsOn: (fs: Directory) => readonly SweepableAccount[];
};

const SYSLOG_AUTH_SWEEP: SweepLog = {
  path: AUTH_LOG_PATH,
  owner: AUTH_LOG_OWNER,
  permissions: AUTH_LOG_PERMISSIONS,
  formatAttempt: formatSshdAuthLine,
};

export const SERVICE_CATALOG = {
  ssh: {
    service: 'ssh',
    pidfile: 'sshd.pid',
    defaultPort: 22,
    runUser: 'root',
    banner: 'SSH-2.0-OpenSSH',
    placement: 0.4,
    altPorts: [2222, 8022],
    altPortChance: 0.2,
    sweepLog: SYSLOG_AUTH_SWEEP,
    accountsOn: accountsIn,
  },
  // One row for the web, not one per server program: `nginx` and `apache2` are two
  // ways to open the SAME port, so they share this identity and cannot both bind it.
  // Rarer than ssh — a box you can log into is ordinary, a box that publishes
  // something is a lead worth following.
  http: {
    service: 'http',
    pidfile: 'nginx.pid',
    defaultPort: 80,
    runUser: 'root',
    // What a web server says to a client that speaks no HTTP at it — which is
    // exactly what a raw connection is.
    banner: 'HTTP/1.1 400 Bad Request',
    placement: 0.3,
    altPorts: [8080, 8000],
    altPortChance: 0.25,
    // INHERITED, NOT DESIGNED: a sweep against the web door has always been written
    // up as sshd in auth.log, and this row preserves that byte-for-byte rather than
    // deciding it here. A real HTTP brute-force belongs in access.log as a run of
    // 401s — that is the web door's call to make, not the ftp door's.
    sweepLog: SYSLOG_AUTH_SWEEP,
    accountsOn: accountsIn,
  },
  // As common as the web and below ssh: a box you can log into is ordinary, and a
  // box that will hand you its files without one should be about as findable as a
  // box that publishes something. Rolled independently of ssh, so a share of these
  // hosts run NO ssh at all — the box a credential sweep of :22 can never open, and
  // the reason a second door is worth having rather than a second way through the
  // same one.
  ftp: {
    service: 'ftp',
    pidfile: 'vsftpd.pid',
    defaultPort: 21,
    runUser: 'root',
    banner: '220 FTP server ready.',
    placement: 0.3,
    altPorts: [2121],
    altPortChance: 0.2,
    sweepLog: {
      path: VSFTPD_LOG_PATH,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
      formatAttempt: formatVsftpdLoginLine,
      formatArrival: formatVsftpdConnectLine,
    },
    accountsOn: accountsIn,
  },
  // The only door whose credential is not the box's own: mysql accounts live in the
  // datadir, not in /etc/passwd, so cracking a box and cracking its database are two
  // locks with two keys. Rarer than every other row — a database daemon on a random
  // home box should read as somebody's mistake, and what makes a db- box worth
  // finding is the role override rather than this rate.
  mysql: {
    service: 'mysql',
    pidfile: 'mysqld.pid',
    defaultPort: 3306,
    // Not root, unlike every row above: the /etc/mysql.cnf a database box has carried
    // since the roles landed says `user=mysql`, and `ps` prints this field. Running it
    // as root would put the box's own config and its own process table in disagreement
    // about who holds the daemon.
    runUser: 'mysql',
    // What mysqld says to a client that speaks no mysql at it. Its REAL greeting is a
    // version string, which this field may not carry — so the handshake it refuses is
    // the only thing left that identifies the port in its own words.
    banner: 'ERROR 1043 (08S01): Bad handshake',
    placement: 0.08,
    // No alternate ports, alone among the rows. The config file on every database box
    // states `port=3306` as a literal, so a box listening anywhere else would be
    // contradicted by a file a guest can read.
    altPorts: [],
    altPortChance: 0,
    sweepLog: {
      path: MYSQL_LOG_PATH,
      owner: MYSQL_LOG_OWNER,
      permissions: MYSQL_LOG_PERMISSIONS,
      formatAttempt: formatMysqlAttemptLine,
    },
    // The one row that does not read `/etc/passwd`: a database's accounts live in its
    // datadir, drawn on their own stream, so cracking this box's shell and cracking its
    // database are two locks with two keys.
    accountsOn: databaseAccountsIn,
  },
} as const satisfies Record<string, ServiceSpec>;

/** The service a caller named (`ssh`, `ftp`), or undefined for one the world has no
 *  row for. The name reaching this lookup is player input, so an unknown service is
 *  an ordinary answer, not a fault. */
export const serviceByName = (name: string): ServiceSpec | undefined =>
  Object.values(SERVICE_CATALOG).find((spec) => spec.service === name);
