const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

type SyslogLineOptions = {
  readonly date: Date;
  readonly hostname: string;
  readonly service: string;
  readonly pid: number;
  readonly message: string;
};

/** Format a syslog-style timestamp+header: `MMM DD HH:MM:SS hostname service[pid]: message` */
export const formatSyslogLine = ({
  date,
  hostname,
  service,
  pid,
  message,
}: SyslogLineOptions): string => {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate().toString().padStart(2, ' ');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${minutes}:${seconds} ${hostname} ${service}[${pid}]: ${message}`;
};

type SshLogOptions = {
  readonly date: Date;
  readonly hostname: string;
  readonly pid: number;
  readonly user: string;
  readonly fromIp: string;
  readonly port: number;
};

export const formatSshAccepted = ({
  date,
  hostname,
  pid,
  user,
  fromIp,
  port,
}: SshLogOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: 'sshd',
    pid,
    message: `Accepted password for ${user} from ${fromIp} port ${port} ssh2`,
  });

export const formatSshAcceptedKey = ({
  date,
  hostname,
  pid,
  user,
  fromIp,
  port,
}: SshLogOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: 'sshd',
    pid,
    message: `Accepted publickey for ${user} from ${fromIp} port ${port} ssh2`,
  });

export const formatSshFailed = ({
  date,
  hostname,
  pid,
  user,
  fromIp,
  port,
}: SshLogOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: 'sshd',
    pid,
    message: `Failed password for ${user} from ${fromIp} port ${port} ssh2`,
  });

type SuLogOptions = {
  readonly date: Date;
  readonly hostname: string;
  readonly pid: number;
  readonly targetUser: string;
  readonly fromUser: string;
};

export const formatSuSuccess = ({
  date,
  hostname,
  pid,
  targetUser,
  fromUser,
}: SuLogOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: 'su',
    pid,
    message: `Successful su for ${targetUser} by ${fromUser}`,
  });

export const formatSuFailed = ({
  date,
  hostname,
  pid,
  targetUser,
  fromUser,
}: SuLogOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: 'su',
    pid,
    message: `FAILED su for ${targetUser} by ${fromUser}`,
  });

// SCP uses SSH auth — same log format as SSH
export const formatScpAccepted = formatSshAccepted;
export const formatScpFailed = formatSshFailed;

// vsftpd log format: [YYYY-MM-DD HH:MM:SS] EVENT: message
const formatVsftpdTimestamp = (date: Date): string => {
  const y = date.getUTCFullYear();
  const mo = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `[${y}-${mo}-${d} ${h}:${mi}:${s}]`;
};

export const formatFtpConnect = (date: Date, clientIp: string): string =>
  `${formatVsftpdTimestamp(date)} CONNECT: Client "${clientIp}"`;

type FtpLoginOptions = {
  readonly date: Date;
  readonly clientIp: string;
  readonly user: string;
};

export const formatFtpLoginOk = ({ date, clientIp, user }: FtpLoginOptions): string =>
  `${formatVsftpdTimestamp(date)} OK LOGIN: Client "${clientIp}", user "${user}"`;

export const formatFtpLoginFailed = ({ date, clientIp, user }: FtpLoginOptions): string =>
  `${formatVsftpdTimestamp(date)} FAIL LOGIN: Client "${clientIp}", user "${user}"`;

// MySQL general log format: YYYY-MM-DDTHH:MM:SS.000000Z\t threadId Event\tmessage
const formatMysqlTimestamp = (date: Date): string => {
  const y = date.getUTCFullYear();
  const mo = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000000Z`;
};

type MysqlConnectOptions = {
  readonly date: Date;
  readonly threadId: number;
  readonly user: string;
  readonly sourceIp: string;
  readonly dbName: string;
};

export const formatMysqlConnect = ({
  date,
  threadId,
  user,
  sourceIp,
  dbName,
}: MysqlConnectOptions): string =>
  `${formatMysqlTimestamp(date)}\t${threadId} Connect\t${user}@${sourceIp} on ${dbName} using TCP/IP`;

type MysqlAccessDeniedOptions = {
  readonly date: Date;
  readonly threadId: number;
  readonly user: string;
  readonly sourceIp: string;
};

export const formatMysqlAccessDenied = ({
  date,
  threadId,
  user,
  sourceIp,
}: MysqlAccessDeniedOptions): string =>
  `${formatMysqlTimestamp(date)}\t${threadId} Connect\tAccess denied for user '${user}'@'${sourceIp}' (using password: YES)`;

// Redis log format: pid:role DD MMM YYYY HH:MM:SS.mmm * message
const formatRedisTimestamp = (date: Date): string => {
  const d = date.getUTCDate().toString().padStart(2, ' ');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const;
  const mo = months[date.getUTCMonth()];
  const y = date.getUTCFullYear();
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${d} ${mo} ${y} ${h}:${mi}:${s}.000`;
};

type RedisAuthOptions = {
  readonly date: Date;
  readonly pid: number;
  readonly sourceIp: string;
};

export const formatRedisAuth = ({ date, pid, sourceIp }: RedisAuthOptions): string =>
  `${pid}:M ${formatRedisTimestamp(date)} * Client ${sourceIp} authenticated successfully`;

export const formatRedisAuthDenied = ({ date, pid, sourceIp }: RedisAuthOptions): string =>
  `${pid}:M ${formatRedisTimestamp(date)} # Client ${sourceIp} authentication failed`;

type AccessLogOptions = {
  readonly date: Date;
  readonly clientIp: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly size: number;
};

// Apache Combined Log Format: ip - - [DD/MMM/YYYY:HH:MM:SS +0000] "METHOD /path HTTP/1.1" status size
export const formatAccessLog = ({
  date,
  clientIp,
  method,
  path,
  status,
  size,
}: AccessLogOptions): string => {
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  const ts = `${day}/${month}/${year}:${h}:${mi}:${s} +0000`;
  return `${clientIp} - - [${ts}] "${method} ${path} HTTP/1.1" ${status} ${size}`;
};

// --- Exploit attempt formatters ---
// Produce realistic log lines for the attackPattern carried on each
// Vulnerability. Each formatter corresponds to one AttackPattern variant.

type VsftpdAttackOptions = {
  readonly date: Date;
  readonly clientIp: string;
  readonly command: string;
};

// vsftpd command-level log line (same format as other vsftpd events)
export const formatVsftpdAttack = ({ date, clientIp, command }: VsftpdAttackOptions): string =>
  `${formatVsftpdTimestamp(date)} FTP command: Client "${clientIp}", "${command}"`;

type MysqlAttackOptions = {
  readonly date: Date;
  readonly threadId: number;
  readonly sourceIp: string;
  readonly query: string;
};

// MySQL general log — "Query" event with the raw statement
export const formatMysqlAttack = ({
  date,
  threadId,
  sourceIp,
  query,
}: MysqlAttackOptions): string =>
  `${formatMysqlTimestamp(date)}\t${threadId} Query\t/* from ${sourceIp} */ ${query}`;

type RedisAttackOptions = {
  readonly date: Date;
  readonly pid: number;
  readonly sourceIp: string;
  readonly message: string;
};

// Redis log — warning-level (#) entry for suspicious activity
export const formatRedisAttack = ({ date, pid, sourceIp, message }: RedisAttackOptions): string =>
  `${pid}:M ${formatRedisTimestamp(date)} # Client ${sourceIp} ${message}`;

type MailAttackOptions = {
  readonly date: Date;
  readonly hostname: string;
  readonly pid: number;
  readonly daemon: 'postfix/smtpd' | 'dovecot' | 'courier';
  readonly sourceIp: string;
  readonly message: string;
};

// Mail log — syslog-format entry with a mail daemon tag. The sourceIp is
// embedded in the message since mail.log doesn't have a dedicated peer field.
export const formatMailAttack = ({
  date,
  hostname,
  pid,
  daemon,
  sourceIp,
  message,
}: MailAttackOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: daemon,
    pid,
    message: `[${sourceIp}] ${message}`,
  });

type SyslogAttackOptions = {
  readonly date: Date;
  readonly hostname: string;
  readonly pid: number;
  readonly daemon: string;
  readonly sourceIp: string;
  readonly message: string;
};

// Generic syslog fallback for services without a dedicated log file
export const formatSyslogAttack = ({
  date,
  hostname,
  pid,
  daemon,
  sourceIp,
  message,
}: SyslogAttackOptions): string =>
  formatSyslogLine({
    date,
    hostname,
    service: daemon,
    pid,
    message: `[${sourceIp}] ${message}`,
  });
