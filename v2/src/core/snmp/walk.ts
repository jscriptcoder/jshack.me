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
