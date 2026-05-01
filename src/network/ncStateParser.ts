// Parses nc pid file content to determine backdoor listener ports.
// Pid file format: "nc:port=4444,user=webadmin,userType=user,home=/home/webadmin"
// Multiple pid files can exist: /var/run/nc-4444.pid, /var/run/nc-8888.pid, etc.

import type { ServiceOwner } from './types';
import type { FileNode } from '../filesystem/types';
import { isValidUserType } from '../session/sessionUtils';

export type NcPortOverride = {
  readonly port: number;
  readonly service: 'elite';
  readonly open: true;
  readonly owner: ServiceOwner;
};

const PID_PATTERN = /^nc:port=(\d+),user=([^,]+),userType=([^,]+),home=(.+)$/;

export const parseNcPidContent = (content: string | undefined): readonly NcPortOverride[] => {
  if (!content) return [];

  const match = content.match(PID_PATTERN);
  if (!match) return [];

  const [, portStr, username, userType, homePath] = match;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  if (!isValidUserType(userType)) return [];

  return [
    {
      port,
      service: 'elite',
      open: true,
      owner: { username, userType, homePath },
    },
  ];
};

// Scans a /var/run/ directory node for nc-*.pid files and parses each.
export const parseNcPidFiles = (varRunNode: FileNode | null): readonly NcPortOverride[] => {
  if (!varRunNode || varRunNode.type !== 'directory' || !varRunNode.children) return [];

  return Object.entries(varRunNode.children).flatMap(([name, node]) => {
    if (!name.startsWith('nc-') || !name.endsWith('.pid')) return [];
    if (node.type !== 'file' || !node.content) return [];
    return parseNcPidContent(node.content);
  });
};
