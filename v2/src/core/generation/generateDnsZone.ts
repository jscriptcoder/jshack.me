/**
 * generateDnsZone — the two files a name server keeps on disk: the zone, and the
 * config that declares it.
 *
 * Ported from legacy `src/generation/filesystem/networkConfig.ts`
 * (`generateDnsZoneContent`, `generateDnsNamedConf`) for their FILE FORMAT: the origin,
 * the SOA block and its five timers, the fifteen-column names that make a wall of
 * records readable, and the one zone stanza the config carries. Legacy's zone described
 * a mission that v2 does not have; the shape it wrote is the part worth keeping,
 * because it is the shape a real zone has.
 *
 * BOTH files here because the config names where the zone file goes. Two modules would
 * be two statements of one path, free to disagree — and a server describing a file that
 * is not there is worse than one describing nothing.
 *
 * Three questions, kept apart INSIDE the module: which of a network's hosts belong in
 * its zone, how a zone is written down, and what the config says about it. The
 * formatters know only their own file, so the selection rules — which differ between
 * the home LAN and the layers behind it — can change without anything relearning zone
 * syntax.
 *
 * The file is the payout of this whole door. A player who transfers or reads one gets
 * the addresses of machines no scan of their own layer could have shown them, which is
 * why it has to be a REAL zone rather than a list dressed as one: recognising it is
 * part of the reward.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { Ipv4 } from '../network/interfaces';
import { createPrng } from './prng';
import { generateDeepLayer, hostsOnLayer } from './generateDeepLayer';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { chainLinks } from './lanTopology';
import type { DrawnRole } from './machineRole';
import { roleOfHostname } from './pools/hostnames';

/** One name in the zone and the address it answers with. Deliberately NOT a `LanHost`:
 *  a zone knows nothing about what kind of device is behind a name, and deep-layer
 *  records come from somewhere else entirely. */
export type ZoneRecord = {
  /** The bare label, unqualified — `$ORIGIN` is what makes it a full name. */
  readonly name: string;
  readonly ip: Ipv4;
};

/**
 * The machine roles a home LAN's zone carries. An ALLOW-list rather than a list of the
 * two it drops, though the seven drawn roles make the two formulations equivalent
 * today: a zone is a thing an administrator wrote, so a role nobody has decided about
 * belongs outside it until somebody does.
 *
 * What is missing is the half of a home network that is somebody's phone and somebody's
 * camera. Those hold their addresses on DHCP leases, and an authoritative zone that
 * named them would be describing a network that does not stay still. What remains is
 * the part of the address plan that was configured on purpose — and the part worth
 * crossing a network to read.
 */
const ZONED_ROLES: readonly DrawnRole[] = [
  'webserver',
  'fileserver',
  'database',
  'mailserver',
  'dns',
];

/** Routing gear is in whatever it is called, and a machine is in if its name says it
 *  serves something.
 *
 *  Read off `kind` for the first, because a router's name is drawn from its own pool
 *  and claims no role at all — one network's `.1` is CALLED `switch-core` and is a
 *  router, and its `firewall01` is a switch, so a filter reading names would file both
 *  wrongly. Read off the NAME for the second, which is the rule the whole world
 *  follows: a deep box is named from its fronting gateway's stream, and re-deriving a
 *  role from coordinates would contradict the name a player just read off a scan. */
const belongsInZone = (host: LanHost): boolean => {
  if (host.kind !== 'machine') return true;
  const role = roleOfHostname(host.hostname);
  return role !== undefined && ZONED_ROLES.includes(role);
};

const asRecord = ({ hostname, ip }: LanHost): ZoneRecord => ({ name: hostname, ip });

/**
 * Every host standing on the layers behind `essid`'s gateways, in the order the chain
 * reaches them: each layer's own machine, then the gateway that fronts the next one
 * down, all the way to the network's seeded depth.
 *
 * NOTHING is filtered here, and the same camera the home LAN drops is kept. A deep
 * layer holds exactly one machine, at a fixed address, behind a gateway an
 * administrator configured — that is infrastructure however the role dice named it,
 * and it is the intelligence a player crosses a network to get.
 *
 * Walked through `chainLinks`, which is the network's ONE traversal — the pivot scan's
 * vantage and the deep write target come off the same walk. A second one here would be
 * a second opinion about the shape of the network, free to disagree with the scan a
 * player checks the zone against.
 */
const deepRecordsFor = (essid: string): readonly ZoneRecord[] =>
  chainLinks(essid).flatMap((link) =>
    hostsOnLayer(
      generateDeepLayer(
        essid,
        { machineId: link.machineId, kind: link.host.kind },
        { hangsChild: link.hangsChild },
      ),
    ).map(asRecord),
  );

/**
 * Every record the zone for `essid` carries: the home LAN's configured half first, then
 * the layers behind it.
 *
 * The home LAN keeps `generateHomeLan`'s own order, which is by address — so the file
 * opens as a walk up the subnet, readable the way a scan is. No sort of its own: a
 * second ordering would be a second claim about one thing, free to disagree with the
 * first.
 *
 * The `10.x` block comes last because it is the file's argument. Everything above it a
 * player could have found by scanning the segment they are standing on; everything
 * below it they could not.
 */
export const zoneRecordsFor = (essid: string): readonly ZoneRecord[] => [
  ...generateHomeLan(essid).hosts.filter(belongsInZone).map(asRecord),
  ...deepRecordsFor(essid),
];

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

/** Where a name server keeps its zone files. BIND's own default location, so the path
 *  reads as a real one to anybody who has seen a Debian box. */
const ZONE_DIR = '/etc/bind/zones';

/** The config file itself, under `/etc/bind` rather than loose in `/etc` — which is
 *  where a Debian bind9 really puts it, and what keeps the zone file beside it instead
 *  of two unrelated paths a player has to learn separately. */
export const NAMED_CONF_PATH: AbsPath = asAbsPath('/etc/bind/named.conf');

/** The file holding `zone`'s records. Stated HERE, once, because the config names this
 *  path and whatever writes the zone out must write it to the same place — a server
 *  describing a file that is not there is worse than one describing nothing. */
export const zoneFilePathFor = (zone: string): AbsPath => asAbsPath(`${ZONE_DIR}/db.${zone}`);

/** How often a name server will hand its whole zone to anyone who asks.
 *
 *  Open is the COMMON case deliberately. A server locked down every time would make
 *  the door a coin flip a player cannot influence and cannot learn to read; leaving it
 *  open on most is both the misconfiguration real networks actually have, and what
 *  makes the closed one worth noticing when it turns up. */
const TRANSFER_OPEN_CHANCE = 0.75;

/**
 * Whether the name server at `ip` on `essid` allows a zone transfer.
 *
 * Seeded from the network and the address and NOTHING else — no identity in the
 * signature, so two occupants of one access point can never be told different things
 * about the same server, and no reload can change its answer. A find that did not
 * repeat would be one a player could neither confirm nor explain.
 *
 * Its own stream, as every generated draw is: appending to another would move every
 * value picked after it, including the octets the lease allocator excludes.
 */
export const allowsZoneTransfer = (essid: string, ip: Ipv4): boolean =>
  createPrng(`dns-axfr-${essid}-${ip}`).next() < TRANSFER_OPEN_CHANCE;

/**
 * The `named.conf` a name server publishes about itself.
 *
 * Ported from legacy `generateDnsNamedConf` with one line changed: `recursion no`,
 * where legacy's varied. This box is authoritative for one zone and there is no DNS in
 * this world beyond the LAN it stands on, so a config advertising recursion would
 * invite a player to ask it a question nothing can answer — and it is what a real
 * authoritative server says besides.
 *
 * Shorter than the zone and read first. It gives a player two things the zone cannot:
 * where the zone file is, and whether they need to root the box at all.
 */
export const formatNamedConf = ({
  hostname,
  zone,
  allowsTransfer,
}: {
  readonly hostname: string;
  readonly zone: string;
  readonly allowsTransfer: boolean;
}): string =>
  [
    `// named.conf — ${hostname}`,
    'options {',
    '  directory "/var/cache/bind";',
    '  listen-on port 53 { any; };',
    '  recursion no;',
    '  allow-query { any; };',
    '};',
    '',
    `zone "${zone}" {`,
    '  type master;',
    `  file "${zoneFilePathFor(zone)}";`,
    `  allow-transfer { ${allowsTransfer ? 'any' : 'none'}; };`,
    '};',
  ].join('\n');
