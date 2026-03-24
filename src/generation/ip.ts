import type { Prng } from './prng';

// Realistic public IP first-octet pools (routable hosting/cloud prefixes)
export const publicFirstOctets: readonly number[] = [
  45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212,
];

// Generates a public IP with a PRNG-picked first octet from realistic prefixes
export const generatePublicIp = (prng: Prng): string => {
  const o1 = prng.pick(publicFirstOctets);
  const o2 = prng.nextInt(1, 254);
  const o3 = prng.nextInt(1, 254);
  const o4 = prng.nextInt(2, 254);
  return `${o1}.${o2}.${o3}.${o4}`;
};

// Generates a private subnet prefix from RFC 1918 ranges.
// Range 0 = 10.x.x, Range 1 = 172.{16-31}.x, Range 2 = 192.168.{2-254}
export const generatePrivateSubnet = (prng: Prng): string => {
  const rangeType = prng.nextInt(0, 2);
  if (rangeType === 0) return `10.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}`;
  if (rangeType === 1) return `172.${prng.nextInt(16, 31)}.${prng.nextInt(1, 254)}`;
  // 192.168.{2-254} — avoids 192.168.1.x (static localhost/gateway network)
  return `192.168.${prng.nextInt(2, 254)}`;
};
