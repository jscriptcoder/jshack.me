// Heuristic that gates the cross-LAN seed-regen resolver: an input is
// "public" if it parses as a dotted-quad IPv4 AND falls outside every
// reserved/private/loopback/link-local/CGNAT/multicast/reserved range.
//
// Used by ensureForeignReachable as a fast pre-filter so the resolver
// never burns a server round-trip on local-address inputs (10.x, 127.x,
// 192.168.x, etc.) that can't possibly be a foreign home network.
//
// Game-specific note: RFC 5737 documentation ranges (192.0.2/24,
// 198.51.100/24, 203.0.113/24) are treated as PUBLIC because the game
// assigns them to playground / techparts.io / world networks. This
// keeps the resolver code path uniform — world IPs still short-circuit
// at the sync findMachineByIp layer above the resolver, so no wasted
// API call happens in practice.

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const parseOctets = (ip: string): readonly [number, number, number, number] | null => {
  const match = IPV4_PATTERN.exec(ip);
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number.parseInt(part!, 10));
  if (octets.some((octet) => !Number.isFinite(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
};

export const isPublicIpv4 = (ip: string): boolean => {
  const octets = parseOctets(ip);
  if (octets === null) return false;
  const [first, second] = octets;

  // 0.0.0.0/8 — "this network"
  if (first === 0) return false;
  // 10.0.0.0/8 — RFC1918 private
  if (first === 10) return false;
  // 127.0.0.0/8 — loopback
  if (first === 127) return false;
  // 100.64.0.0/10 — Carrier-Grade NAT (RFC6598)
  if (first === 100 && second >= 64 && second <= 127) return false;
  // 169.254.0.0/16 — link-local
  if (first === 169 && second === 254) return false;
  // 172.16.0.0/12 — RFC1918 private
  if (first === 172 && second >= 16 && second <= 31) return false;
  // 192.168.0.0/16 — RFC1918 private
  if (first === 192 && second === 168) return false;
  // 224.0.0.0/4 — multicast (first octet 224-239)
  if (first >= 224 && first <= 239) return false;
  // 240.0.0.0/4 — reserved (includes 255.255.255.255 broadcast)
  if (first >= 240) return false;

  return true;
};
