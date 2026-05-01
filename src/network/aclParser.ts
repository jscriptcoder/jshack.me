// Parses ACL (Access Control List) rules from /etc/switch/acl.conf.
// Format: `<action> <proto> any <subnet> port <port>`
// Ignores comments (#), blank lines, and malformed lines.

export type AclAction = 'allow' | 'deny';

export type AclRule = {
  readonly action: AclAction;
  readonly protocol: string;
  readonly destination: string;
  readonly port: number;
};

const ACL_RULE_RE = /^(allow|deny)\s+(\w+)\s+any\s+([\d./]+)\s+port\s+(\d+)$/;

const parseAclLine = (line: string): AclRule | null => {
  const match = ACL_RULE_RE.exec(line);
  if (!match) return null;

  const port = Number(match[4]);
  if (port < 1 || port > 65535) return null;

  // The regex's first capture group is `(allow|deny)` so `match[1]` is one of
  // those two literals — narrow via comparison rather than asserting.
  const action: AclAction = match[1] === 'allow' ? 'allow' : 'deny';

  return {
    action,
    protocol: match[2],
    destination: match[3],
    port,
  };
};

export const parseAclRules = (content: string): readonly AclRule[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseAclLine)
    .filter((rule): rule is AclRule => rule !== null);

// Checks whether an IP falls within a CIDR /24 subnet.
const ipMatchesSubnet = (ip: string, cidr: string): boolean => {
  const slashIdx = cidr.indexOf('/');
  if (slashIdx === -1) return ip === cidr;
  const subnetBase = cidr.slice(0, slashIdx);
  // Extract the first 3 octets of both and compare
  const ipPrefix = ip.split('.').slice(0, 3).join('.');
  const subnetPrefix = subnetBase.split('.').slice(0, 3).join('.');
  return ipPrefix === subnetPrefix;
};

// Checks if a specific port to a destination is denied by ACL rules.
// Returns true if denied (no allow rule found and a deny rule exists).
// Last matching rule wins (like real ACLs).
export const isPortDeniedByAcl = (
  rules: readonly AclRule[],
  destination: string,
  port: number,
): boolean => {
  const matchingRules = rules.filter(
    (r) => r.port === port && ipMatchesSubnet(destination, r.destination),
  );
  const lastMatch = matchingRules[matchingRules.length - 1];
  return lastMatch?.action === 'deny';
};
