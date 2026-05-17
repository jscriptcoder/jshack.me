// Predicate for routing foreign-IP resolution: only public IPv4 addresses
// can host home_networks rows, so calls to /api/lookup-home-network must
// be gated on this. Without the gate, every local-config miss (including
// internal-subnet IPs that simply aren't loaded yet) would burn a server
// round-trip before getting negative-cached.
//
// Returns true for routable IPv4 — anything outside RFC1918, loopback,
// link-local, multicast, broadcast, or the unspecified 0/8 range. The
// game allocator (src/generation/ip.ts) and the world_networks fixtures
// all use publicly-classified prefixes (45/51/62/91/103/138/162/185/198/
// 203/212) so the predicate's positive cases match real game inputs.

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const isPublicIpv4 = (ip: string): boolean => {
  const match = IPV4_REGEX.exec(ip);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a > 255 || b > 255 || Number(match[3]) > 255 || Number(match[4]) > 255) return false;
  if (a === 0) return false; // 0.0.0.0/8 unspecified / reserved
  if (a === 10) return false; // 10.0.0.0/8 RFC1918
  if (a === 127) return false; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 RFC1918
  if (a >= 224) return false; // 224.0.0.0/4 multicast + reserved
  return true;
};
