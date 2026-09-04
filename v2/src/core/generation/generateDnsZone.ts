/**
 * generateDnsZone — the zone file a name server keeps on disk.
 *
 * Ported from legacy `src/generation/filesystem/networkConfig.ts`
 * (`generateDnsZoneContent`) for its FILE FORMAT: the origin, the SOA block and its
 * five timers, and the fifteen-column names that make a wall of records readable.
 * Legacy's zone described a mission that v2 does not have; the shape it wrote is the
 * part worth keeping, because it is the shape a real zone has.
 *
 * A FORMATTER only. Which hosts belong in a zone is a question about the network, and
 * it is answered where the network is known; this module is handed the records and
 * writes them down. Keeping the two apart is what lets the selection rules change —
 * and they differ per layer — without anything relearning zone syntax.
 *
 * The file is the payout of this whole door. A player who transfers or reads one gets
 * the addresses of machines no scan of their own layer could have shown them, which is
 * why it has to be a REAL zone rather than a list dressed as one: recognising it is
 * part of the reward.
 */

import type { Ipv4 } from '../network/interfaces';

/** One name in the zone and the address it answers with. Deliberately NOT a `LanHost`:
 *  a zone knows nothing about what kind of device is behind a name, and deep-layer
 *  records come from somewhere else entirely. */
export type ZoneRecord = {
  /** The bare label, unqualified — `$ORIGIN` is what makes it a full name. */
  readonly name: string;
  readonly ip: Ipv4;
};

/** Seconds a resolver may cache an answer for. One hour, on every record and as the
 *  zone default, which is what a home network's own zone really looks like. */
const TTL_SECONDS = 3600;

/** The column names are padded into. Legacy's width, kept: it fits every hostname the
 *  generator draws with room to spare, and a longer name is left to overrun rather
 *  than be clipped — a truncated name would be a lie about what the host is called. */
const NAME_COLUMN = 15;

/** The SOA's five timers, in the order the record fixes them. A serial a secondary
 *  compares, then how often to ask, how soon to retry, when to give up, and how long a
 *  negative answer keeps. Values a plausible home zone would carry; nothing in the game
 *  acts on them, and a zone missing one is a zone a real resolver rejects. */
const SOA_TIMERS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 2024030101, label: 'serial' },
  { value: TTL_SECONDS, label: 'refresh' },
  { value: 1800, label: 'retry' },
  { value: 604800, label: 'expire' },
  { value: 86400, label: 'minimum' },
];

/** The widest timer value, so the `;` comments line up under each other however the
 *  numbers are edited. Derived rather than counted by hand, because a comment column
 *  that drifted would be the first thing a reader noticed and the last thing anybody
 *  meant. */
const TIMER_COLUMN = Math.max(...SOA_TIMERS.map(({ value }) => String(value).length));

/**
 * The zone `nameserver` is authoritative for, as a file.
 *
 * `zone` and `nameserver` arrive separately because the zone is the network's and the
 * name server is one box on it: two boxes could serve one zone, and each would write
 * its own name into the SOA and NS lines of the same domain.
 */
export const formatDnsZone = ({
  zone,
  nameserver,
  records,
}: {
  readonly zone: string;
  /** The bare hostname of the box publishing this file. */
  readonly nameserver: string;
  readonly records: readonly ZoneRecord[];
}): string => {
  // Absolute on every name it writes. A zone whose own origin was relative would
  // append itself to itself, and the trailing dot is the only thing saying otherwise.
  const authority = `${nameserver}.${zone}.`;

  return [
    `; Zone file for ${zone}`,
    `$ORIGIN ${zone}.`,
    `$TTL ${TTL_SECONDS}`,
    '',
    `@  IN SOA ${authority} hostmaster.${zone}. (`,
    ...SOA_TIMERS.map(
      ({ value, label }) => `     ${String(value).padEnd(TIMER_COLUMN)} ; ${label}`,
    ),
    ')',
    `@  IN NS  ${authority}`,
    '',
    '; A records',
    ...records.map(
      ({ name, ip }) => `${name.padEnd(NAME_COLUMN)} ${TTL_SECONDS}  IN  A  ${ip}`,
    ),
  ].join('\n');
};
