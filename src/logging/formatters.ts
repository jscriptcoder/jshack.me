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

/** Format a syslog-style timestamp+header: `MMM DD HH:MM:SS hostname service[pid]: message` */
export const formatSyslogLine = (
  date: Date,
  hostname: string,
  service: string,
  pid: number,
  message: string,
): string => {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate().toString().padStart(2, ' ');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${minutes}:${seconds} ${hostname} ${service}[${pid}]: ${message}`;
};

export const formatSshAccepted = (
  date: Date,
  hostname: string,
  pid: number,
  user: string,
  fromIp: string,
  port: number,
): string =>
  formatSyslogLine(
    date,
    hostname,
    'sshd',
    pid,
    `Accepted password for ${user} from ${fromIp} port ${port} ssh2`,
  );

export const formatSshAcceptedKey = (
  date: Date,
  hostname: string,
  pid: number,
  user: string,
  fromIp: string,
  port: number,
): string =>
  formatSyslogLine(
    date,
    hostname,
    'sshd',
    pid,
    `Accepted publickey for ${user} from ${fromIp} port ${port} ssh2`,
  );

export const formatSshFailed = (
  date: Date,
  hostname: string,
  pid: number,
  user: string,
  fromIp: string,
  port: number,
): string =>
  formatSyslogLine(
    date,
    hostname,
    'sshd',
    pid,
    `Failed password for ${user} from ${fromIp} port ${port} ssh2`,
  );

export const formatSuSuccess = (
  date: Date,
  hostname: string,
  pid: number,
  targetUser: string,
  fromUser: string,
): string =>
  formatSyslogLine(date, hostname, 'su', pid, `Successful su for ${targetUser} by ${fromUser}`);

export const formatSuFailed = (
  date: Date,
  hostname: string,
  pid: number,
  targetUser: string,
  fromUser: string,
): string =>
  formatSyslogLine(date, hostname, 'su', pid, `FAILED su for ${targetUser} by ${fromUser}`);

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

export const formatFtpLoginOk = (date: Date, clientIp: string, user: string): string =>
  `${formatVsftpdTimestamp(date)} OK LOGIN: Client "${clientIp}", user "${user}"`;

export const formatFtpLoginFailed = (date: Date, clientIp: string, user: string): string =>
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

export const formatMysqlConnect = (
  date: Date,
  threadId: number,
  user: string,
  sourceIp: string,
  dbName: string,
): string =>
  `${formatMysqlTimestamp(date)}\t${threadId} Connect\t${user}@${sourceIp} on ${dbName} using TCP/IP`;

export const formatMysqlAccessDenied = (
  date: Date,
  threadId: number,
  user: string,
  sourceIp: string,
): string =>
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

export const formatRedisAuth = (date: Date, pid: number, sourceIp: string): string =>
  `${pid}:M ${formatRedisTimestamp(date)} * Client ${sourceIp} authenticated successfully`;

export const formatRedisAuthDenied = (date: Date, pid: number, sourceIp: string): string =>
  `${pid}:M ${formatRedisTimestamp(date)} # Client ${sourceIp} authentication failed`;

// Apache Combined Log Format: ip - - [DD/MMM/YYYY:HH:MM:SS +0000] "METHOD /path HTTP/1.1" status size
export const formatAccessLog = (
  date: Date,
  clientIp: string,
  method: string,
  path: string,
  status: number,
  size: number,
): string => {
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const h = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  const ts = `${day}/${month}/${year}:${h}:${mi}:${s} +0000`;
  return `${clientIp} - - [${ts}] "${method} ${path} HTTP/1.1" ${status} ${size}`;
};
