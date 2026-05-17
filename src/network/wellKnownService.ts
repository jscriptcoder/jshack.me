// Port → service name lookup for the canonical set used in jshack.me.
// Used by the cross-LAN forward synthesizer (mergeForeignRouterForwards):
// when an iptables forward targets an occupant or otherwise-unknown
// machine, we don't have the real port's service field locally, but the
// rule's internal-port number alone gives us a useful display label.
// Real port scanners do the same (nmap's default service detection is
// just /etc/services lookup until -sV deeper probing).
//
// Intentionally small set — common services only. Returns undefined for
// anything unmapped so callers can pick their own sentinel.

const PORT_SERVICES: ReadonlyMap<number, string> = new Map([
  [21, 'ftp'],
  [22, 'ssh'],
  [25, 'smtp'],
  [53, 'dns'],
  [80, 'http'],
  [110, 'pop3'],
  [143, 'imap'],
  [161, 'snmp'],
  [443, 'https'],
  [3306, 'mysql'],
  [5432, 'postgresql'],
  [6379, 'redis'],
  [8080, 'http-alt'],
]);

export const serviceForPort = (port: number): string | undefined => PORT_SERVICES.get(port);
