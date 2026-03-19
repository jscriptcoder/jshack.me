// Parses ncat pid file content to determine backdoor listener ports.
// Pid file format: "ncat:port=4444,user=webadmin,userType=user,home=/home/webadmin"
// Multiple pid files can exist: /var/run/ncat-4444.pid, /var/run/ncat-8888.pid, etc.

import type { ServiceOwner } from './types';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';

export type NcatPortOverride = {
  readonly port: number;
  readonly service: 'elite';
  readonly open: true;
  readonly owner: ServiceOwner;
};

const VALID_USER_TYPES: ReadonlySet<string> = new Set(['root', 'user', 'guest']);

const PID_PATTERN = /^ncat:port=(\d+),user=([^,]+),userType=([^,]+),home=(.+)$/;

export const parseNcatPidContent = (content: string | undefined): readonly NcatPortOverride[] => {
  if (!content) return [];

  const match = content.match(PID_PATTERN);
  if (!match) return [];

  const [, portStr, username, userType, homePath] = match;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  if (!VALID_USER_TYPES.has(userType)) return [];

  return [
    {
      port,
      service: 'elite',
      open: true,
      owner: { username, userType: userType as UserType, homePath },
    },
  ];
};

// Scans a /var/run/ directory node for ncat-*.pid files and parses each.
export const parseNcatPidFiles = (varRunNode: FileNode | null): readonly NcatPortOverride[] => {
  if (!varRunNode || varRunNode.type !== 'directory' || !varRunNode.children) return [];

  return Object.entries(varRunNode.children).flatMap(([name, node]) => {
    if (!name.startsWith('ncat-') || !name.endsWith('.pid')) return [];
    if (node.type !== 'file' || !node.content) return [];
    return parseNcatPidContent(node.content);
  });
};
