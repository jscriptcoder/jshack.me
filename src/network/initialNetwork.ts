import type { NetworkInterface } from './types';

// === Localhost interface templates ===
// Used by NetworkContext to represent localhost's network state.

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

export const localhostDisconnectedInterfaces: readonly NetworkInterface[] = [
  loopbackInterface,
  localhostWlan0Down,
];
