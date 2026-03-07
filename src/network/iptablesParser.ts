import type { NatForwardingRule } from '../generation/types';

// Parses iptables-style port forwarding rules from file content.
// Format: `forward <public_port> to <internal_ip>:<internal_port>`
// Ignores comments (#), blank lines, and malformed lines.
export const parseIptablesRules = (content: string): readonly NatForwardingRule[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseForwardRule)
    .filter((rule): rule is NatForwardingRule => rule !== null);

const FORWARD_RULE_RE = /^forward\s+(\d+)\s+to\s+([\d.]+):(\d+)$/;

const parseForwardRule = (line: string): NatForwardingRule | null => {
  const match = FORWARD_RULE_RE.exec(line);
  if (!match) return null;

  const publicPort = Number(match[1]);
  const internalIp = match[2] as string;
  const internalPort = Number(match[3]);

  if (publicPort < 1 || publicPort > 65535 || internalPort < 1 || internalPort > 65535) return null;

  return { publicPort, internalIp, internalPort };
};
