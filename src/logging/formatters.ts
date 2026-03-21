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
