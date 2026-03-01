import type { NetworkConfig, RemoteMachine, DnsRecord, NetworkInterface } from './types';

// === Shared machine definitions ===

const gatewayMachine: RemoteMachine = {
  ip: '192.168.1.1',
  hostname: 'gateway',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [
    { username: 'admin', passwordHash: 'dab569cb96513965ca00379d69b2f40c', userType: 'root' }, // n3tgu4rd!
    { username: 'guest', passwordHash: 'dbf0171774108c80c94819b1ce0dbd9b', userType: 'guest' }, // guest2024
  ],
};

const localhostMachine: RemoteMachine = {
  ip: '192.168.1.100',
  hostname: 'localhost',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [
    { username: 'root', passwordHash: '63a9f0ea7bb98050796b649e85481845', userType: 'root' }, // root
    { username: 'jshacker', passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99', userType: 'user' }, // password
    { username: 'guest', passwordHash: '084e0343a0486ff05530df6c705c8bb4', userType: 'guest' }, // guest
  ],
};

const fileserverMachine: RemoteMachine = {
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [
    { port: 21, service: 'ftp', open: true },
    { port: 22, service: 'ssh', open: true },
  ],
  users: [
    { username: 'root', passwordHash: '4a080e0e088d55294ab894a02b5c8e3f', userType: 'root' }, // b4ckup2024
    { username: 'ftpuser', passwordHash: 'be7a9d8e813210208cb7fba28717cda7', userType: 'user' }, // tr4nsf3r
    { username: 'guest', passwordHash: '294de3557d9d00b3d2d8a1e6aab028cf', userType: 'guest' }, // anonymous
  ],
};

// === DNS records ===

const localDns: readonly DnsRecord[] = [
  { domain: 'gateway.local', ip: '192.168.1.1', type: 'A' },
  { domain: 'fileserver.local', ip: '192.168.1.50', type: 'A' },
];

// === Shared interface templates ===

const loopbackInterface: NetworkInterface = {
  name: 'lo',
  flags: ['UP', 'LOOPBACK', 'RUNNING'],
  inet: '127.0.0.1',
  netmask: '255.0.0.0',
  gateway: '0.0.0.0',
  mac: '00:00:00:00:00:00',
};

export const localhostWlan0Down: NetworkInterface = {
  name: 'wlan0',
  flags: ['BROADCAST', 'MULTICAST'],
  inet: '0.0.0.0',
  netmask: '0.0.0.0',
  gateway: '0.0.0.0',
  mac: '02:42:ac:11:00:02',
};

export const localhostWlan0Up: NetworkInterface = {
  name: 'wlan0',
  flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
  inet: '192.168.1.100',
  netmask: '255.255.255.0',
  gateway: '192.168.1.1',
  mac: '02:42:ac:11:00:02',
};

export const localhostDisconnectedInterfaces: readonly NetworkInterface[] = [
  loopbackInterface,
  localhostWlan0Down,
];

export const localhostConnectedInterfaces: readonly NetworkInterface[] = [
  loopbackInterface,
  localhostWlan0Up,
];

// === Per-machine network configs ===

export const createInitialNetwork = (): NetworkConfig => ({
  machineConfigs: {
    localhost: {
      interfaces: localhostConnectedInterfaces,
      machines: [gatewayMachine, fileserverMachine],
      dnsRecords: localDns,
    },
    '192.168.1.1': {
      interfaces: [
        {
          name: 'eth0',
          flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
          inet: '192.168.1.1',
          netmask: '255.255.255.0',
          gateway: '192.168.1.1',
          mac: '02:42:ac:11:00:0a',
        },
      ],
      machines: [localhostMachine, fileserverMachine],
      dnsRecords: localDns,
    },
    '192.168.1.50': {
      interfaces: [
        {
          name: 'eth0',
          flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
          inet: '192.168.1.50',
          netmask: '255.255.255.0',
          gateway: '192.168.1.1',
          mac: '02:42:ac:11:00:32',
        },
      ],
      machines: [localhostMachine, gatewayMachine],
      dnsRecords: localDns,
    },
  },
});
