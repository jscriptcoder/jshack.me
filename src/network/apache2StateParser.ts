import type { ServiceOwner } from './types';
import { isValidUserType } from '../session/sessionUtils';

// Parses apache2 pid file content to determine the HTTP port to open and
// the owner the daemon was started by.
//
// Pid file format (single line, all four fields required):
//   apache2:port=N,user=U,userType=T,home=H
//
// Examples:
//   apache2:port=80,user=alice,userType=user,home=/home/alice
//   apache2:port=8443,user=root,userType=root,home=/root
//
// Owner is the invoking user (not a hardcoded www-data) so player-hosted
// sites surface the runner's identity — the CVE shell_full effect spawns
// shells as the owner.

export type Apache2PortOverride = {
  readonly port: number;
  readonly service: 'http' | 'https' | 'http-alt';
  readonly open: true;
  readonly owner: ServiceOwner;
};

export const APACHE2_PID_FILE_PATH = '/var/run/apache2.pid';
export const APACHE2_PID_FILE_NAME = 'apache2.pid';

// `[^,\n\r]+` for the open-ended fields rejects multi-line content and
// stray newlines; the anchor `$` alone is not enough because `[^,]` would
// otherwise absorb a trailing newline into the captured value.
// userType captured as `[^,\n\r]+` then narrowed via isValidUserType so the
// rejection branch is exercised when callers ship a forged value.
const APACHE2_LINE = /^apache2:port=(\d+),user=([^,\n\r]+),userType=([^,\n\r]+),home=([^,\n\r]+)$/;

const serviceForPort = (port: number): 'http' | 'https' | 'http-alt' => {
  if (port === 443) return 'https';
  if (port === 8080) return 'http-alt';
  return 'http';
};

export const parseApache2State = (content: string | undefined): readonly Apache2PortOverride[] => {
  if (!content) return [];

  const match = content.match(APACHE2_LINE);
  if (!match) return [];

  const [, portStr, username, userType, homePath] = match;
  const port = Number(portStr);
  if (port < 1 || port > 65535) return [];
  if (!isValidUserType(userType)) return [];

  return [
    {
      port,
      service: serviceForPort(port),
      open: true,
      owner: { username, userType, homePath },
    },
  ];
};
