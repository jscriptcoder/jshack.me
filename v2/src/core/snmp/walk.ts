/**
 * How a device answers a walk — the block a client prints when its community string is
 * accepted.
 *
 * Bare object names over ONLY the facts the game models. Two things are deliberately
 * absent, and each was removed for a reason a player can feel:
 *
 * The MIB MODULE PREFIXES are gone. `NAT-MIB::natForward.2222` named a module a player
 * never needs and, worse, was not the name the write took: `snmpset` accepts
 * `forward.2222`, so the device's own output pasted straight back was refused as a name
 * that does not exist. What a walk prints is now exactly what a set accepts, on every
 * line it prints.
 *
 * The TYPE TAGS are gone with them. `STRING:` on every line said nothing the value did
 * not already say, and it was the widest column in the block.
 *
 * The full net-snmp walk is not rendered either: `sysObjectID`, `Timeticks`,
 * `ifPhysAddress` and `ipAdEntAddr` are facts this world cannot hold and a player cannot
 * act on, so every one of them would bury the lines that matter under lines that mean
 * nothing. What is here maps 1:1 onto something the world actually holds — which is also
 * what stops this block becoming a second source of truth for facts kept elsewhere.
 *
 * NO VERSION is stated anywhere. `sysDescr` is the obvious carrier for a non-Debian
 * device's version, and stating one before the game decides where a device version
 * lives would make this block a competing authority for the fact vulnerabilities are
 * keyed on.
 *
 * Pure: given an identity, the same block every time. Who the device is and which
 * addresses it holds are the caller's to resolve.
 */

import type { NatForward } from '../network/iptablesRules';

export type SnmpDeviceKind = 'router' | 'switch';

export type SnmpIdentity = {
  readonly hostname: string;
  readonly kind: SnmpDeviceKind;
  /** Who to shout at, per the device's own `snmpd.conf` — the one identity fact no
   *  other file in the world knows. */
  readonly sysContact: string;
  /** Every address the device holds, in interface order. A gateway that fronts the
   *  world has two; anything behind one has a single address on its own segment. */
  readonly addresses: readonly string[];
};

/** One rendered row before it is aligned: the object's name, and what it holds. Kept as
 *  a pair rather than a finished string so the column can be fitted to the widest name
 *  in the block the caller is actually printing. */
type OidRow = readonly [name: string, value: string];

/** What each kind of device calls itself and its interfaces. This is the whole of the
 *  difference a walk can see between a router and a switch, and it is the reason a
 *  player bothers walking one: two boxes that answered identically would make the tool
 *  pointless on the very devices it exists for.
 *
 *  A switch numbers its ports from 1 and a Linux box numbers its interfaces from 0,
 *  which is true of both platforms and is why the mapping is per-kind rather than one
 *  shared index. */
const PLATFORM: Readonly<
  Record<
    SnmpDeviceKind,
    { readonly description: string; readonly interfaceName: (index: number) => string }
  >
> = {
  router: { description: 'Linux', interfaceName: (index) => `eth${index}` },
  switch: {
    description: 'Cisco IOS L3 Switch',
    interfaceName: (index) => `GigabitEthernet0/${index + 1}`,
  },
};

const padRight = (value: string, length: number): string =>
  value.length >= length ? value : value + ' '.repeat(length - value.length);

/** The block with its `=` column fitted to the widest name in it, plus one space — so
 *  the longest line always keeps a gap before its `=` and every shorter block loses the
 *  slack a fixed column would have carried. */
const alignRows = (rows: readonly OidRow[]): readonly string[] => {
  const column = Math.max(...rows.map(([name]) => name.length)) + 1;
  return rows.map(([name, value]) => `${padRight(name, column)}= ${value}`);
};

/** The device's identity. `sysName` IS the hostname and `sysDescr` is built from it, so
 *  neither is stored anywhere — a walk that read them from a file could disagree with
 *  the box's real name the moment somebody edited it.
 *
 *  An interface is ONE row carrying its name and its address together. Split across an
 *  `ifDescr` block and an `ifAddr` block, a player answering "where does this device
 *  sit" had to join the two halves by index; joined here, it is the same two facts with
 *  the work already done — and it halves the rows an interface costs. */
const identityRows = (identity: SnmpIdentity): readonly OidRow[] => {
  const platform = PLATFORM[identity.kind];
  return [
    ['sysDescr', `${platform.description} ${identity.hostname}`],
    ['sysName', identity.hostname],
    ['sysContact', identity.sysContact],
    ...identity.addresses.map(
      (address, index): OidRow => [
        `interface.${index + 1}`,
        `${platform.interfaceName(index)} (${address})`,
      ],
    ),
  ];
};

/** A device's port table as the file that holds it denotes it. Two shapes because two
 *  platforms keep two different facts: a router forwards a public port INTO its
 *  segment, and a switch denies one outright. Tagged after the TABLE rather than after
 *  the device so it cannot be mistaken for a second opinion on `SnmpIdentity.kind`. */
export type SnmpPortTable =
  | { readonly kind: 'nat'; readonly forwards: readonly NatForward[] }
  | { readonly kind: 'acl'; readonly denies: readonly number[] }
  | { readonly kind: 'filter'; readonly denies: readonly number[] };

/** What each table calls itself: the verb an empty one has done nothing of, and the
 *  `snmpset` a player would write next. Keeping the two together is what stops a switch
 *  being offered a router's write syntax.
 *
 *  A VERB rather than a whole sentence, because a device holding two tables says the
 *  empty thing ONCE — "forwards and denies no ports" is one device with an untouched
 *  file, where two sentences would read as two devices. */
const TABLE_VOCABULARY: Readonly<
  Record<SnmpPortTable['kind'], { readonly verb: string; readonly writable: string }>
> = {
  nat: { verb: 'forwards', writable: 'forward.<port>=<ip>:<port>' },
  acl: { verb: 'denies', writable: 'aclPort.<port>=deny' },
  filter: { verb: 'denies', writable: 'inputPort.<port>=deny' },
};

/** What a forwarded public port is CALLED, and what a denied one is. Exported because
 *  `snmpset` parses and echoes the same names: one device, one spelling, and a line off
 *  a walk is a line a set takes.
 *
 *  `forward` rather than `natForward` because it is the verb the device's own
 *  `/etc/iptables/rules.v4` already uses — `forward 2222 to 10.0.0.10:22` under `nano`,
 *  `forward.2222=10.0.0.10:22` here. One fact reached two ways should not need two
 *  words. */
export const forwardOid = (publicPort: number): string => `forward.${publicPort}`;
export const aclPortOid = (port: number): string => `aclPort.${port}`;
/** Named for the CHAIN rather than for the filter, matching the header `rules.v4`
 *  carries on a box that keeps one. */
export const inputPortOid = (port: number): string => `inputPort.${port}`;

/** Which name a denied port carries. Two tables deny ports and they are not the same
 *  fact: a switch shuts one behind itself, a host shuts one on itself. */
const denyOid: Readonly<Record<'acl' | 'filter', (port: number) => string>> = {
  acl: aclPortOid,
  filter: inputPortOid,
};

const portTableRows = (portTable: SnmpPortTable): readonly OidRow[] =>
  portTable.kind === 'nat'
    ? portTable.forwards.map(
        (forward): OidRow => [
          forwardOid(forward.publicPort),
          `${forward.internalIp}:${forward.internalPort}`,
        ],
      )
    : portTable.denies.map((port): OidRow => [denyOid[portTable.kind](port), 'deny']);

const WRITABLE_LABEL = 'Writable: ';

/** One syntax per table the device holds, under a label written once, carrying the
 *  address and community the caller ACTUALLY used. A placeholder would make a player
 *  retype the two things they had just typed to reach the one part they had not; with
 *  the real ones in place the line is pasted back with a port filled in.
 *
 *  Two `Writable:` labels would read as two devices, so the rest align under the first. */
const writableLines = ({
  target,
  community,
  portTables,
}: {
  readonly target: string;
  readonly community: string;
  readonly portTables: readonly SnmpPortTable[];
}): readonly string[] =>
  portTables.map(
    (portTable, index) =>
      (index === 0 ? WRITABLE_LABEL : ' '.repeat(WRITABLE_LABEL.length)) +
      `snmpset ${target} ${community} ${TABLE_VOCABULARY[portTable.kind].writable}`,
  );

/** What a device with nothing in any of its tables says — one sentence naming every
 *  fact it holds none of. Two tables that deny the same way collapse to one verb. */
const emptinessLine = (portTables: readonly SnmpPortTable[]): string => {
  const verbs = [
    ...new Set(portTables.map((portTable) => TABLE_VOCABULARY[portTable.kind].verb)),
  ];
  return `This device ${verbs.join(' and ')} no ports.`;
};

/** The whole accepted-walk block, header to trailer.
 *
 *  The header names the tier and the device in one line rather than echoing back the
 *  address the player just typed and then naming the tier underneath it.
 *
 *  The trailer points at the tier that answers more. Neither legacy nor real net-snmp
 *  says any such thing — but this is the one door whose entire promise is the WRITE, and
 *  a player who has just learned a device's name should not have to go looking for what
 *  the next community string buys. */
export const renderIdentityWalk = ({
  target,
  community,
  identity,
}: {
  readonly target: string;
  readonly community: string;
  readonly identity: SnmpIdentity;
}): readonly string[] => {
  const rows = identityRows(identity);
  return [
    `[READ-ONLY] Community "${community}" accepted on ${target}.`,
    '',
    ...alignRows(rows),
    '',
    `${rows.length} OIDs returned. Community "${community}" is READ-ONLY.`,
    "Retry with a read-write community to see this device's port table.",
  ];
};

/** The read-write tier: everything the read-only walk returns, plus the device's port
 *  table and the lines that say how to change it.
 *
 *  A SEPARATE entry point rather than the read-only render with a table bolted on. A
 *  device that forwards nothing is the ORDINARY state of a fresh router — default-deny
 *  means the shipped `rules.v4` parses to an empty table — so a renderer that decided
 *  the tier from whether there were rows would answer most cracked communities as
 *  though they had been refused. The tier is the caller's assertion here, and an empty
 *  table renders as the fact it is.
 *
 *  It names no tier in its footer, unlike the read-only block: the `Writable:` lines
 *  below say what the community bought, and saying it twice would be the one thing the
 *  block already proves. */
export const renderReadWriteWalk = ({
  target,
  community,
  identity,
  portTables,
}: {
  readonly target: string;
  readonly community: string;
  readonly identity: SnmpIdentity;
  /** EVERY table the device's files hold, in the order they are rendered. A list rather
   *  than one table because a workstation and a gateway keep their two chains in the
   *  same `rules.v4` and nothing a walk can read tells the two boxes apart — so the
   *  device answers with what its file SAYS instead of with what its kind implies. */
  readonly portTables: readonly SnmpPortTable[];
}): readonly string[] => {
  const tableRows = portTables.flatMap(portTableRows);
  const rows = [...identityRows(identity), ...tableRows];
  return [
    `[READ-WRITE] Community "${community}" accepted on ${target}.`,
    '',
    ...alignRows(rows),
    '',
    ...(tableRows.length === 0 ? [emptinessLine(portTables)] : []),
    `${rows.length} OIDs returned.`,
    ...writableLines({ target, community, portTables }),
  ];
};
