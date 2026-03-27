// Parses SNMP ACL OIDs from /etc/snmp/snmpd.conf on switch devices.
// Returns a list of port overrides based on ACL OID values.
// aclSSH allow → port 22 open
// aclHTTP allow → port 80 open
// aclFTP allow → port 21 open

const ACL_PORT_MAP: Readonly<Record<string, number>> = {
  aclSSH: 22,
  aclHTTP: 80,
  aclFTP: 21,
};

export type SnmpAclOverride = {
  readonly port: number;
  readonly allowed: boolean;
};

export const parseSnmpAclConfig = (content: string): readonly SnmpAclOverride[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('acl'))
    .map((line) => {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return null;
      const oid = line.slice(0, spaceIdx);
      const value = line.slice(spaceIdx + 1);
      const port = ACL_PORT_MAP[oid];
      if (port === undefined) return null;
      return { port, allowed: value === 'allow' };
    })
    .filter((o): o is SnmpAclOverride => o !== null);
