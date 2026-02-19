import type { FileNode } from './types';
import {
  localhost,
  gateway,
  fileserver,
  webserver,
  darknet,
  shadow,
  voidFs,
  abyss,
} from './machines/__encoded';

export type MachineId = string;

export const machineFileSystems: Readonly<Record<string, FileNode>> = {
  localhost,
  '192.168.1.1': gateway,
  '192.168.1.50': fileserver,
  '192.168.1.75': webserver,
  '203.0.113.42': darknet,
  '10.66.66.1': shadow,
  '10.66.66.2': voidFs,
  '10.66.66.3': abyss,
};

// _machineId is unused today (all machines use the same /home/username convention)
// but kept in the signature so callers pass it — allows per-machine home paths later
// without changing every call site
export const getDefaultHomePath = (_machineId: string, username: string): string => {
  if (username === 'root') return '/root';
  return `/home/${username}`;
};
