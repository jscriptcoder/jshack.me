// Per-service version templates used by the procedural timeline generator
// (see src/generation/timeline/). The prefix + separator + starting tuple
// define where the generator begins and what its version strings look like.
//
// Starting tuples are chosen to be one step beyond the newest hand-authored
// CVE version for each service so the procedural timeline doesn't collide
// with the historical table in vulnerabilities.ts.

export type VersionTemplate = {
  readonly prefix: string; // e.g., 'Apache/' or 'OpenSSH '
  readonly separator: string; // e.g., '.' (usually)
  readonly startTuple: readonly number[]; // e.g., [2, 4, 60]
};

export const serviceTemplates: Readonly<Record<string, VersionTemplate>> = {
  http: { prefix: 'Apache/', separator: '.', startTuple: [2, 4, 60] },
  'http-alt': { prefix: 'Tomcat/', separator: '.', startTuple: [10, 1, 14] },
  https: { prefix: 'nginx/', separator: '.', startTuple: [1, 26, 0] },
  ftp: { prefix: 'vsftpd ', separator: '.', startTuple: [3, 0, 6] },
  mysql: { prefix: 'MySQL ', separator: '.', startTuple: [8, 0, 36] },
  postgresql: { prefix: 'PostgreSQL ', separator: '.', startTuple: [16, 2, 0] },
  redis: { prefix: 'Redis ', separator: '.', startTuple: [7, 2, 5] },
  mongodb: { prefix: 'MongoDB ', separator: '.', startTuple: [7, 0, 3] },
  smtp: { prefix: 'Postfix ', separator: '.', startTuple: [3, 8, 0] },
  imap: { prefix: 'Dovecot ', separator: '.', startTuple: [2, 3, 21] },
  pop3: { prefix: 'Dovecot ', separator: '.', startTuple: [2, 3, 21] },
  mqtt: { prefix: 'Mosquitto ', separator: '.', startTuple: [2, 0, 19] },
  smb: { prefix: 'Samba ', separator: '.', startTuple: [4, 19, 3] },
  rsync: { prefix: 'rsync ', separator: '.', startTuple: [3, 3, 0] },
  vnc: { prefix: 'TightVNC ', separator: '.', startTuple: [2, 9, 0] },
  modbus: { prefix: 'ModbusTCP ', separator: '.', startTuple: [2, 1, 0] },
  openvpn: { prefix: 'OpenVPN ', separator: '.', startTuple: [2, 6, 9] },
  dns: { prefix: 'BIND ', separator: '.', startTuple: [9, 18, 22] },
  elasticsearch: { prefix: 'Elasticsearch ', separator: '.', startTuple: [8, 12, 0] },
  ssh: { prefix: 'OpenSSH ', separator: '.', startTuple: [9, 7, 0] },
};

export const formatVersion = (template: VersionTemplate, tuple: readonly number[]): string =>
  template.prefix + tuple.join(template.separator);
