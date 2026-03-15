// Parses SNMP firewall OIDs from /etc/snmp/snmpd.conf.
// Returns a map of port numbers to whether they should be open.
// firewallSSH permit → port 22 open
// firewallHTTP permit → port 80 open

const FIREWALL_PORT_MAP: Readonly<Record<string, number>> = {
  firewallSSH: 22,
  firewallHTTP: 80,
};

export type SnmpFirewallOverride = {
  readonly port: number;
  readonly open: boolean;
};

export const parseSnmpFirewallConfig = (content: string): readonly SnmpFirewallOverride[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('firewall'))
    .map((line) => {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return null;
      const oid = line.slice(0, spaceIdx);
      const value = line.slice(spaceIdx + 1);
      const port = FIREWALL_PORT_MAP[oid];
      if (port === undefined) return null;
      return { port, open: value === 'permit' };
    })
    .filter((o): o is SnmpFirewallOverride => o !== null);
