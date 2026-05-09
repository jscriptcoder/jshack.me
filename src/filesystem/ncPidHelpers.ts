import type { UserType } from '../session/types';

// Pure parser for nc backdoor pidfile content. The format is the single
// line written by `startNcListener` (src/commands/nc.ts):
//
//   nc:port=<port>,user=<username>,userType=<root|user|guest>,home=<path>
//
// Used server-side by handleAuthCreateSession's nc-pidfile branch (PR 5
// of plans/cross-player-base-fs-replication.md). The client-side
// equivalent — parseNcPidContent in src/network/ncStateParser.ts —
// returns NcPortOverride[] for FS-walk purposes; this helper returns
// a flat result tuned to the server's needs (no NcPortOverride wrapper,
// no ServiceOwner shape).
//
// Returns undefined when content is null/undefined/empty, when the
// line doesn't match the canonical shape, when fields are in the wrong
// order or missing, when port is out of range, or when userType is
// outside the literal `'root' | 'user' | 'guest'` set.

export type ParsedNcPid = {
  readonly port: number;
  readonly username: string;
  readonly userType: UserType;
  readonly homePath: string;
};

const PID_PATTERN = /^nc:port=(\d+),user=([^,]+),userType=([^,]+),home=(.+)$/;

const isValidUserType = (value: string): value is UserType =>
  value === 'root' || value === 'user' || value === 'guest';

export const parseNcPid = (content: string | null | undefined): ParsedNcPid | undefined => {
  if (!content) return undefined;
  const match = content.match(PID_PATTERN);
  if (!match) return undefined;
  const [, portStr, username, userType, homePath] = match;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (!isValidUserType(userType)) return undefined;
  return { port, username, userType, homePath };
};
