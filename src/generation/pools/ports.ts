import type { EntryVariant, MachineRole } from '../types';
import { secrets } from '../../secrets/__encoded';

export type PortTemplate = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp';
};

export const portTemplatesByRole: Readonly<Record<MachineRole, readonly PortTemplate[]>> = {
  webserver: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 443, service: 'https', open: true },
  ],
  database: [
    { port: 22, service: 'ssh', open: true },
    { port: 3306, service: 'mysql', open: true },
    { port: 5432, service: 'postgresql', open: false },
    { port: 6379, service: 'redis', open: false },
    { port: 27017, service: 'mongodb', open: false },
  ],
  fileserver: [
    { port: 21, service: 'ftp', open: true },
    { port: 22, service: 'ssh', open: true },
    { port: 445, service: 'smb', open: false },
    { port: 873, service: 'rsync', open: false },
  ],
  workstation: [
    { port: 22, service: 'ssh', open: true },
    { port: 8080, service: 'http-alt', open: false },
    { port: 5900, service: 'vnc', open: false },
  ],
  mailserver: [
    { port: 22, service: 'ssh', open: true },
    { port: 25, service: 'smtp', open: true },
    { port: 110, service: 'pop3', open: false },
    { port: 143, service: 'imap', open: true },
    { port: 993, service: 'imaps', open: false },
  ],
  iot: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 502, service: 'modbus', open: false },
    { port: 1883, service: 'mqtt', open: true },
    { port: 8443, service: 'https', open: false },
  ],
  dns: [
    { port: 22, service: 'ssh', open: true },
    { port: 53, service: 'dns', open: true, protocol: 'udp' },
    { port: 953, service: 'rndc', open: false },
  ],
  router: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 1194, service: 'openvpn', open: false },
    { port: 8443, service: 'https', open: false },
  ],
  switch: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 161, service: 'snmp', open: true, protocol: 'udp' },
  ],
};

export const backdoorPorts: readonly number[] = [4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234];

// Public-facing ports the client wants exposed via port forwarding on the router.
// Non-standard ports that wouldn't normally be forwarded.
export const forwardPublicPorts: readonly number[] = [
  8080, 8443, 9090, 8888, 3000, 4443, 9443, 8000, 3001, 5000,
];

// SNMP read-write community strings — common misconfigurations and vendor defaults.
// Encoded at build time to prevent finding them in the JS bundle.
export const snmpRwCommunities: readonly string[] = JSON.parse(
  secrets.SNMP_COMMUNITIES,
) as readonly string[];

export type EntryPortTemplate = {
  readonly variant: EntryVariant;
  readonly ports: readonly PortTemplate[];
};

export const entryPortTemplates: readonly EntryPortTemplate[] = [
  {
    variant: 'ssh',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'ftp',
    ports: [
      { port: 21, service: 'ftp', open: true },
      { port: 22, service: 'ssh', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 4444, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 31337, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8888, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1337, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 9999, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 5555, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 6666, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1234, service: 'elite', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 3306, service: 'mysql', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 6379, service: 'redis', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 21, service: 'ftp', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 25, service: 'smtp', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1883, service: 'mqtt', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 5432, service: 'postgresql', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 445, service: 'smb', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 27017, service: 'mongodb', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 5900, service: 'vnc', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 443, service: 'https', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8080, service: 'http-alt', open: true },
    ],
  },
];

// Entry port templates when the router itself is the entry point (router-first mode)
export const routerEntryPortTemplates: readonly EntryPortTemplate[] = [
  {
    variant: 'ssh',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'ftp',
    ports: [
      { port: 21, service: 'ftp', open: true },
      { port: 22, service: 'ssh', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 4444, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 31337, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8888, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1337, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 9999, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 5555, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 6666, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1234, service: 'elite', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8443, service: 'https', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8080, service: 'http-alt', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1883, service: 'mqtt', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1194, service: 'openvpn', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 443, service: 'https', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8080, service: 'http-alt', open: true },
    ],
  },
  {
    variant: 'snmp',
    ports: [
      { port: 22, service: 'ssh', open: false },
      { port: 161, service: 'snmp', open: true, protocol: 'udp' },
    ],
  },
];
