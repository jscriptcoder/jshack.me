/**
 * Whose journal row an AP GATEWAY's own system logs accrete under — its `kern.log` for
 * a public scan, its `auth.log` for a login on the port it serves itself.
 *
 * The gateway is the access point's infrastructure rather than a player's property, so
 * it has no owner key of its own — but `patches` rows are keyed
 * `(machine_id, path, writer_key)` and a log patch carries the WHOLE file, so on replay
 * the newest row for a path wins outright. Split one log across two writer keys and the
 * later row silently erases the earlier one's lines. The key therefore has to be STABLE,
 * not merely present.
 *
 * The lowest octet leased on the ESSID is that key: leases are permanent and outlive
 * occupancy, so it does not move when players join, leave, or rejoin, and it does not
 * depend on the order the store hands the rows back. An ESSID nobody has ever leased an
 * address on has no key at all, and the AP simply keeps no log — the same best-effort
 * posture as a failed write.
 */

import type { LanLeaseRow } from '../network/lanAddress';

export const apGatewayLogWriterKey = (leases: readonly LanLeaseRow[]): string | null =>
  leases.reduce<LanLeaseRow | null>(
    (lowest, lease) => (lowest === null || lease.octet < lowest.octet ? lease : lowest),
    null,
  )?.owner_key ?? null;
