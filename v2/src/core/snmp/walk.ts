/**
 * How a device answers a walk — the OID block a client prints when its community
 * string is accepted.
 *
 * Real MIB prefixes and real types, column-aligned, over ONLY the OIDs the game
 * models. The full net-snmp walk is deliberately not rendered: `sysObjectID`,
 * `Timeticks`, `ifPhysAddress` and `ipAdEntAddr` are facts this world cannot hold and
 * a player cannot act on, so every one of them would bury the lines that matter under
 * lines that mean nothing. What is here maps 1:1 onto something the world actually
 * holds — which is also what stops this block becoming a second source of truth for
 * facts kept elsewhere.
 *
 * `IpAddress:` rather than `STRING:` for an address is the one place real SNMP typing
 * carries information, so it is kept.
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

/** Wide enough for the longest OID name rendered here (`SNMPv2-MIB::sysContact.0`)
 *  plus a two-space gutter, so the `=` column never moves between devices. */
const OID_COLUMN = 26;

/** Wide enough for `IpAddress:` plus one space — the longest type this block prints. */
const TYPE_COLUMN = 11;

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

const oidLine = (oid: string, type: 'STRING' | 'IpAddress', value: string): string =>
  `${padRight(oid, OID_COLUMN)}= ${padRight(`${type}:`, TYPE_COLUMN)}${value}`;

/** The device's identity as OIDs. `sysName` IS the hostname and `sysDescr` is built
 *  from it, so neither is stored anywhere — a walk that read them from a file could
 *  disagree with the box's real name the moment somebody edited it. */
const identityOids = (identity: SnmpIdentity): readonly string[] => {
  const platform = PLATFORM[identity.kind];
  return [
    oidLine(
      'SNMPv2-MIB::sysDescr.0',
      'STRING',
      `${platform.description} ${identity.hostname}`,
    ),
    oidLine('SNMPv2-MIB::sysName.0', 'STRING', identity.hostname),
    oidLine('SNMPv2-MIB::sysContact.0', 'STRING', identity.sysContact),
    ...identity.addresses.map((_, index) =>
      oidLine(`IF-MIB::ifDescr.${index + 1}`, 'STRING', platform.interfaceName(index)),
    ),
    ...identity.addresses.map((address, index) =>
      oidLine(`IF-MIB::ifAddr.${index + 1}`, 'IpAddress', address),
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
  nat: {
    verb: 'forwards',
    writable: 'snmpset <host> <community> natForward.<port>=<ip>:<port>',
  },
  acl: { verb: 'denies', writable: 'snmpset <host> <community> aclPort.<port>=deny' },
  filter: { verb: 'denies', writable: 'snmpset <host> <community> inputPort.<port>=deny' },
};

/** What a forwarded public port is CALLED, and what a denied one is. Exported because
 *  `snmpset` echoes the same names back: one device, two commands, one spelling. A set
 *  that answered with an OID the walk does not print would read as a different fact
 *  than the one it just changed. */
export const natForwardOid = (publicPort: number): string => `NAT-MIB::natForward.${publicPort}`;
export const aclPortOid = (port: number): string => `ACL-MIB::aclPort.${port}`;
/** Named for the CHAIN rather than for the filter: `INPUT-MIB::inputPort.65535` is
 *  exactly as wide as the OID column, and `FILTER-MIB` would run one character over and
 *  shunt the `=` on every five-digit port. */
export const inputPortOid = (port: number): string => `INPUT-MIB::inputPort.${port}`;

/** Which OID a denied port carries. Two tables deny ports and they are not the same
 *  fact: a switch shuts one behind itself, a host shuts one on itself. */
const denyOid: Readonly<Record<'acl' | 'filter', (port: number) => string>> = {
  acl: aclPortOid,
  filter: inputPortOid,
};

const portTableOids = (portTable: SnmpPortTable): readonly string[] =>
  portTable.kind === 'nat'
    ? portTable.forwards.map((forward) =>
        oidLine(
          natForwardOid(forward.publicPort),
          'STRING',
          `${forward.internalIp}:${forward.internalPort}`,
        ),
      )
    : portTable.denies.map((port) =>
        oidLine(denyOid[portTable.kind](port), 'STRING', 'deny'),
      );

const WRITABLE_LABEL = 'Writable: ';

/** One syntax per table the device holds, under a label written once. Two `Writable:`
 *  lines would read as two devices; the rest align under the first. */
const writableLines = (portTables: readonly SnmpPortTable[]): readonly string[] =>
  portTables.map(
    (portTable, index) =>
      (index === 0 ? WRITABLE_LABEL : ' '.repeat(WRITABLE_LABEL.length)) +
      TABLE_VOCABULARY[portTable.kind].writable,
  );

/** What a device with nothing in any of its tables says — one sentence naming every
 *  fact it holds none of. Two tables that deny the same way collapse to one verb. */
const emptinessLine = (portTables: readonly SnmpPortTable[]): string => {
  const verbs = [...new Set(portTables.map((portTable) => TABLE_VOCABULARY[portTable.kind].verb))];
  return `This device ${verbs.join(' and ')} no ports.`;
};

/** The whole accepted-walk block, header to trailer.
 *
 *  The trailer names the tier it answered at and points at the one that answers more.
 *  Neither legacy nor real net-snmp says any such thing — but this is the one door
 *  whose entire promise is the WRITE, and a player who has just learned a device's name
 *  should not have to go looking for what the next community string buys. */
export const renderIdentityWalk = ({
  target,
  community,
  identity,
}: {
  readonly target: string;
  readonly community: string;
  readonly identity: SnmpIdentity;
}): readonly string[] => {
  const oids = identityOids(identity);
  return [
    `Querying ${target} with community string "${community}"...`,
    `[READ-ONLY] Community "${community}" accepted.`,
    '',
    ...oids,
    '',
    `${oids.length} OIDs returned. Community "${community}" is READ-ONLY.`,
    "Retry with a read-write community to see this device's port table.",
  ];
};

/** The read-write tier: everything the read-only walk returns, plus the device's port
 *  table and the one line that says how to change it.
 *
 *  A SEPARATE entry point rather than the read-only render with a table bolted on. A
 *  device that forwards nothing is the ORDINARY state of a fresh router — default-deny
 *  means the shipped `rules.v4` parses to an empty table — so a renderer that decided
 *  the tier from whether there were rows would answer most cracked communities as
 *  though they had been refused. The tier is the caller's assertion here, and an empty
 *  table renders as the fact it is.
 *
 *  The `Writable:` trailer is neither legacy's nor real net-snmp's. This is the one door
 *  whose entire promise is the write, and a player who has just spent a wordlist on a
 *  community should not then have to go looking for the syntax it bought. */
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
  const rows = portTables.flatMap(portTableOids);
  const oids = [...identityOids(identity), ...rows];
  return [
    `Querying ${target} with community string "${community}"...`,
    `[READ-WRITE] Community "${community}" accepted.`,
    '',
    ...oids,
    '',
    ...(rows.length === 0 ? [emptinessLine(portTables)] : []),
    `${oids.length} OIDs returned. Community "${community}" is READ-WRITE.`,
    ...writableLines(portTables),
  ];
};
