import type { NetworkConfig, RemoteMachine, DnsRecord, NetworkInterface } from './types';

// === Shared machine definitions ===

const gatewayMachine: RemoteMachine = {
  ip: '192.168.1.1',
  hostname: 'gateway',
  ports: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 443, service: 'https', open: true },
  ],
  users: [
    { username: 'admin', passwordHash: 'dab569cb96513965ca00379d69b2f40c', userType: 'root' }, // n3tgu4rd!
    { username: 'guest', passwordHash: 'dbf0171774108c80c94819b1ce0dbd9b', userType: 'guest' }, // guest2024
  ],
};

const gatewayWanMachine: RemoteMachine = {
  ip: '198.51.100.10',
  hostname: 'gateway',
  ports: gatewayMachine.ports,
  users: gatewayMachine.users,
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

const webserverMachine: RemoteMachine = {
  ip: '192.168.1.75',
  hostname: 'webserver',
  ports: [
    { port: 22, service: 'ssh', open: true },
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

const darknetMachine: RemoteMachine = {
  ip: '203.0.113.42',
  hostname: 'darknet',
  ports: [
    { port: 22, service: 'ssh', open: true },
    { port: 8080, service: 'http-alt', open: true },
    {
      port: 31337,
      service: 'elite',
      open: true,
      owner: { username: 'ghost', userType: 'user', homePath: '/home/ghost' },
    },
  ],
  users: [
    { username: 'root', passwordHash: '63d7f708b7feb9c0494c64dbfb087f83', userType: 'root' }, // d4rkn3tR00t
    { username: 'ghost', passwordHash: 'd2aef0b37551aecfb067036d57f14930', userType: 'user' }, // sp3ctr3
    { username: 'guest', passwordHash: 'e5ec4133db0a2e088310e8ecb0ee51d7', userType: 'guest' }, // sh4d0w
  ],
};

const darknetHiddenMachine: RemoteMachine = {
  ip: '10.66.66.100',
  hostname: 'darknet',
  ports: darknetMachine.ports,
  users: darknetMachine.users,
};

const shadowMachine: RemoteMachine = {
  ip: '10.66.66.1',
  hostname: 'shadow',
  ports: [
    { port: 21, service: 'ftp', open: true },
    { port: 22, service: 'ssh', open: true },
  ],
  users: [
    { username: 'root', passwordHash: 'ace0140d2da9deaa60d16eb681afb542', userType: 'root' }, // sh4d0w_r00t
    { username: 'operator', passwordHash: '8687c82d19711171491bbcbda4353a50', userType: 'user' }, // c0ntr0l_pl4n3
    { username: 'guest', passwordHash: 'fe01ce2a7fbac8fafaed7c982a04e229', userType: 'guest' }, // demo
  ],
};

const voidMachine: RemoteMachine = {
  ip: '10.66.66.2',
  hostname: 'void',
  ports: [
    { port: 22, service: 'ssh', open: true },
    {
      port: 9999,
      service: 'maintenance',
      open: true,
      owner: { username: 'dbadmin', userType: 'user', homePath: '/home/dbadmin' },
    },
  ],
  users: [
    { username: 'root', passwordHash: '9581d383d7d09ed2e81c84af511a4d35', userType: 'root' }, // v01d_null
    { username: 'dbadmin', passwordHash: '2b1e0a7a976160137d870678d3b1ed3b', userType: 'user' }, // dr0p_t4bl3s
    { username: 'guest', passwordHash: 'fe01ce2a7fbac8fafaed7c982a04e229', userType: 'guest' }, // demo
  ],
};

const abyssMachine: RemoteMachine = {
  ip: '10.66.66.3',
  hostname: 'abyss',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [
    { username: 'root', passwordHash: 'f81e258a762fbfac58a72dee289ea2c5', userType: 'root' }, // d33p_d4rk
    { username: 'phantom', passwordHash: '7312e6b090b29bd2d55f3284fc2472d2', userType: 'user' }, // sp3ctr4l
    { username: 'guest', passwordHash: 'fe01ce2a7fbac8fafaed7c982a04e229', userType: 'guest' }, // demo
  ],
};

// === Shared DNS records ===

const localDns: readonly DnsRecord[] = [
  { domain: 'gateway.local', ip: '192.168.1.1', type: 'A' },
  { domain: 'fileserver.local', ip: '192.168.1.50', type: 'A' },
  { domain: 'webserver.local', ip: '192.168.1.75', type: 'A' },
];

const darknetDns: readonly DnsRecord[] = [
  { domain: 'darknet.ctf', ip: '203.0.113.42', type: 'A' },
  { domain: 'www.darknet.ctf', ip: '203.0.113.42', type: 'A' },
];

const hiddenDns: readonly DnsRecord[] = [
  { domain: 'shadow.hidden', ip: '10.66.66.1', type: 'A' },
  { domain: 'void.hidden', ip: '10.66.66.2', type: 'A' },
  { domain: 'abyss.hidden', ip: '10.66.66.3', type: 'A' },
];

const lanAndDarknetDns: readonly DnsRecord[] = [...localDns, ...darknetDns];

// === Shared interface templates ===

const createEth0 = (
  inet: string,
  netmask: string,
  gateway: string,
  mac: string,
): NetworkInterface => ({
  name: 'eth0',
  flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
  inet,
  netmask,
  gateway,
  mac,
});

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
      machines: [gatewayMachine, fileserverMachine, webserverMachine, darknetMachine],
      dnsRecords: lanAndDarknetDns,
    },
    '192.168.1.1': {
      interfaces: [
        createEth0('198.51.100.10', '255.255.255.0', '198.51.100.1', '02:42:ac:11:00:01'),
        {
          name: 'eth1',
          flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
          inet: '192.168.1.1',
          netmask: '255.255.255.0',
          gateway: '192.168.1.1',
          mac: '02:42:ac:11:00:0a',
        },
      ],
      machines: [localhostMachine, fileserverMachine, webserverMachine, darknetMachine],
      dnsRecords: lanAndDarknetDns,
    },
    '192.168.1.50': {
      interfaces: [createEth0('192.168.1.50', '255.255.255.0', '192.168.1.1', '02:42:ac:11:00:03')],
      machines: [gatewayMachine, localhostMachine, webserverMachine, darknetMachine],
      dnsRecords: lanAndDarknetDns,
    },
    '192.168.1.75': {
      interfaces: [createEth0('192.168.1.75', '255.255.255.0', '192.168.1.1', '02:42:ac:11:00:04')],
      machines: [gatewayMachine, localhostMachine, fileserverMachine, darknetMachine],
      dnsRecords: lanAndDarknetDns,
    },
    '203.0.113.42': {
      interfaces: [
        createEth0('203.0.113.42', '255.255.255.0', '203.0.113.1', '02:42:ac:11:00:05'),
        {
          name: 'eth1',
          flags: ['UP', 'BROADCAST', 'RUNNING', 'MULTICAST'],
          inet: '10.66.66.100',
          netmask: '255.255.255.0',
          gateway: '10.66.66.100',
          mac: '02:42:ac:11:00:06',
        },
      ],
      machines: [gatewayWanMachine, shadowMachine, voidMachine, abyssMachine],
      dnsRecords: [...darknetDns, ...hiddenDns],
    },
    '10.66.66.1': {
      interfaces: [createEth0('10.66.66.1', '255.255.255.0', '10.66.66.100', '02:42:ac:11:00:07')],
      machines: [darknetHiddenMachine, voidMachine, abyssMachine],
      dnsRecords: hiddenDns,
    },
    '10.66.66.2': {
      interfaces: [createEth0('10.66.66.2', '255.255.255.0', '10.66.66.100', '02:42:ac:11:00:08')],
      machines: [darknetHiddenMachine, shadowMachine, abyssMachine],
      dnsRecords: hiddenDns,
    },
    '10.66.66.3': {
      interfaces: [createEth0('10.66.66.3', '255.255.255.0', '10.66.66.100', '02:42:ac:11:00:09')],
      machines: [darknetHiddenMachine, shadowMachine, voidMachine],
      dnsRecords: hiddenDns,
    },
  },
});
