import type { NetworkConfig, RemoteMachine, DnsRecord, NetworkInterface } from './types';

// === Shared machine definitions ===

const gatewayMachine: RemoteMachine = {
  ip: '192.168.1.1',
  hostname: 'gateway',
  ports: [
    {
      port: 8443,
      service: 'https',
      open: true,
      vulnerability: {
        cve: 'CVE-2019-11510',
        description: 'PulseSecure arbitrary file read',
        serviceVersion: 'PulseSecure/9.0R1',
      },
      owner: { username: 'guest', userType: 'guest', homePath: '/home/guest' },
    },
  ],
  users: [
    { username: 'admin', passwordHash: 'dab569cb96513965ca00379d69b2f40c', userType: 'root' }, // n3tgu4rd!
    { username: 'guest', passwordHash: 'dbf0171774108c80c94819b1ce0dbd9b', userType: 'guest' }, // guest2024
  ],
};

const localhostMachine: RemoteMachine = {
  ip: '192.168.1.100',
  hostname: 'localhost',
  ports: [],
  users: [
    { username: 'root', passwordHash: 'a0ff67e77425eb3cea40ecb60941aea4', userType: 'root' }, // sup3rus3r
    { username: 'jshacker', passwordHash: '25cd52d0d5975297e6c28700caa9dd72', userType: 'user' }, // h4ckth3pl4n3t
    { username: 'guest', passwordHash: '0fb9cbecb7b8881511c69c39db643e8c', userType: 'guest' }, // guestpass
  ],
};

const fileserverMachine: RemoteMachine = {
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [],
  users: [
    { username: 'root', passwordHash: '4a080e0e088d55294ab894a02b5c8e3f', userType: 'root' }, // b4ckup2024
    { username: 'ftpuser', passwordHash: 'be7a9d8e813210208cb7fba28717cda7', userType: 'user' }, // tr4nsf3r
    { username: 'guest', passwordHash: '294de3557d9d00b3d2d8a1e6aab028cf', userType: 'guest' }, // anonymous
  ],
};

const webserverMachine: RemoteMachine = {
  ip: '192.168.1.75',
  hostname: 'webserver',
  ports: [
    { port: 80, service: 'http', open: true },
    { port: 3306, service: 'mysql', open: true },
    {
      port: 4444,
      service: 'elite',
      open: true,
      owner: { username: 'www-data', userType: 'user', homePath: '/var/www' },
    },
  ],
  users: [
    { username: 'root', passwordHash: 'a6f6c10dc3602b020c56ff49fb043ca9', userType: 'root' }, // r00tW3b!
    { username: 'www-data', passwordHash: 'd2d8d0cdf38ea5a54439ffadf7597722', userType: 'user' }, // d3v0ps2024
    { username: 'guest', passwordHash: 'b2ce03aefab9060e1a42bd1aa1c571f6', userType: 'guest' }, // w3lcome
  ],
};

// === DNS records ===

const localDns: readonly DnsRecord[] = [
  { domain: 'gateway.local', ip: '192.168.1.1', type: 'A' },
  { domain: 'fileserver.local', ip: '192.168.1.50', type: 'A' },
  { domain: 'webserver.local', ip: '192.168.1.75', type: 'A' },
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
      machines: [gatewayMachine, fileserverMachine, webserverMachine],
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
      machines: [localhostMachine, fileserverMachine, webserverMachine],
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
      machines: [localhostMachine, gatewayMachine, webserverMachine],
      dnsRecords: localDns,
    },
    '192.168.1.75': {
      interfaces: [
        {
          name: 'eth0',
          flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
          inet: '192.168.1.75',
          netmask: '255.255.255.0',
          gateway: '192.168.1.1',
          mac: '02:42:ac:11:00:4b',
        },
      ],
      machines: [localhostMachine, gatewayMachine, fileserverMachine],
      dnsRecords: localDns,
    },
  },
});
