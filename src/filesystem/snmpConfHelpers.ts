// Server-side parser for /etc/snmp/snmpd.conf — extracts the
// `rwcommunity` (read-write community string) value, or undefined when
// absent / commented out.
//
// SNMP community strings are plaintext in snmpd.conf. The game has two
// flavors: `rocommunity` (read-only) and `rwcommunity` (read-write).
// authCreateSession's snmp arm only validates rwcommunity — read-only
// SNMP doesn't create a session today (snmpwalk is purely client-side
// read; cross-player snmpwalk waits on /api/exploit-read).
//
// Format: `rwcommunity <value> [<source>]` per line — the value is the
// second whitespace-separated token. `#`-prefixed lines are comments.
// Real snmpd.conf supports a third optional source/network field; we
// ignore everything past the value.

export const findSnmpRwCommunity = (content: string | null): string | undefined => {
  if (!content) return undefined;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith('rwcommunity ')) continue;
    const tokens = trimmed.split(/\s+/);
    const value = tokens[1];
    if (!value || value.length === 0) continue;
    return value;
  }
  return undefined;
};
