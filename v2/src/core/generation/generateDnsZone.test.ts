import { describe, expect, it } from 'vitest';
import { lanZoneName } from '../network/resolveName';
import { generateHomeLan } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { formatDnsZone, zoneRecordsFor, type ZoneRecord } from './generateDnsZone';

const ESSID = 'ACME-CORP';
const ZONE = lanZoneName(ESSID);
const NAMESERVER = 'ns-20';

const RECORDS: readonly ZoneRecord[] = [
  { name: 'ns-20', ip: '192.168.42.20' },
  { name: 'web-4', ip: '192.168.42.4' },
  { name: 'switch-core', ip: '192.168.42.48' },
];

const zoneOf = (records: readonly ZoneRecord[] = RECORDS): readonly string[] =>
  formatDnsZone({ zone: ZONE, nameserver: NAMESERVER, records }).split('\n');

/** The lines of the SOA's parenthesised block — everything between the line that
 *  opens it and the one that closes it. */
const soaBlock = (lines: readonly string[]): readonly string[] =>
  lines.slice(
    lines.findIndex((line) => line.includes('SOA')) + 1,
    lines.findIndex((line) => line.trim() === ')'),
  );

/** The A-record lines: name, then the address the line ends with. */
const aRecords = (lines: readonly string[]): readonly ZoneRecord[] =>
  lines
    .filter((line) => line.includes('IN  A'))
    .map((line) => {
      const [name, , , , ip] = line.split(/\s+/);
      return { name, ip };
    });

/**
 * The file a player reads once they have rooted a name server — and, from the next
 * slice on, the file a zone transfer hands over without any rooting at all. It has to
 * be a REAL zone: a player who has seen one before should recognise this as the same
 * thing, and one who has not should be able to take what they learn here to a real one.
 */
describe('the zone file a name server publishes', () => {
  it('declares the origin and the default TTL before any record, as a resolver reads them', () => {
    const lines = zoneOf();

    // The trailing dot is the whole difference between a name and a name RELATIVE to
    // something else. A zone whose origin was not absolute would append itself to
    // itself on every lookup.
    expect(lines[1]).toBe(`$ORIGIN ${ZONE}.`);
    expect(lines[2]).toBe('$TTL 3600');
    expect(lines.findIndex((line) => line.includes('IN  A'))).toBeGreaterThan(2);
  });

  it('names the box itself as the zone authority', () => {
    const lines = zoneOf();

    // Fully qualified on both halves: the server that answers for the zone, and the
    // address that owns it. `hostmaster` is the conventional mailbox — an `@` written
    // as a dot, which is the piece of zone syntax that surprises everybody once.
    expect(lines.find((line) => line.includes('SOA'))).toBe(
      `@  IN SOA ${NAMESERVER}.${ZONE}. hostmaster.${ZONE}. (`,
    );
  });

  it('carries all five SOA timers, each named and each with a value', () => {
    const timers = soaBlock(zoneOf()).map((line) => {
      const [value, label] = line.split(';').map((part) => part.trim());
      return { label, value: Number(value) };
    });

    // Five, in the order the RFC fixes — a zone naming four of them, or naming them
    // out of order, is one a real resolver rejects. The values are what a secondary
    // would honour, so they have to parse as numbers rather than merely be present.
    expect(timers.map(({ label }) => label)).toEqual([
      'serial',
      'refresh',
      'retry',
      'expire',
      'minimum',
    ]);
    for (const { value } of timers) expect(Number.isInteger(value)).toBe(true);
  });

  it('names the box as the zone nameserver too, not only as its authority', () => {
    // The SOA says who is authoritative; the NS record is what a delegation follows.
    // A zone carrying one without the other is the misconfiguration that makes a
    // secondary give up.
    expect(zoneOf().find((line) => line.includes('IN NS'))).toBe(
      `@  IN NS  ${NAMESERVER}.${ZONE}.`,
    );
  });

  it('writes one A record per name given, in the order they were given', () => {
    expect(aRecords(zoneOf())).toEqual([...RECORDS]);
  });

  it('pads names into a column so the addresses line up down the file', () => {
    const lines = zoneOf().filter((line) => line.includes('IN  A'));

    // A wall of records is read by eye before it is read by anything else, and a
    // ragged one hides the host that is out of place. Names longer than the column are
    // left to overrun rather than truncated — a clipped name would be a lie.
    const addressColumns = lines.map((line) => line.indexOf('192.168'));
    expect(new Set(addressColumns).size).toBe(1);
  });
});

/** The sample every generation-time distribution in this repository is measured
 *  over. A rule about which hosts belong in a zone is a rule about the world, and one
 *  network's draw cannot tell it apart from luck. */
const POPULATION_ESSIDS: readonly string[] = [
  'BEAN-THERE-WIFI',
  'SHINRA-5G',
  'ACME-CORP',
  'WEYLAND-NET',
  'CRACK-ME-WIFI',
  'HYDRA-CRACK-WIFI',
  'FETCH-LOG-WIFI',
  'TYRELL-NET',
];

/** Somebody's phone or somebody's camera: the two roles a home LAN is mostly made of
 *  and the two an authoritative zone has no business naming. Both sit on leases, and
 *  a zone that named them would be describing a network that does not stay still. */
const isPersonalDevice = (hostname: string): boolean => {
  const role = roleOfHostname(hostname);
  return role === 'workstation' || role === 'iot';
};

const hostnamesOf = (hosts: readonly { readonly hostname: string }[]): readonly string[] =>
  hosts.map(({ hostname }) => hostname);

const machinesOn = (essid: string) =>
  generateHomeLan(essid).hosts.filter((host) => host.kind === 'machine');

const listedNamesOn = (essid: string): ReadonlySet<string> =>
  new Set(zoneRecordsFor(essid).map(({ name }) => name));

/**
 * A home LAN is more than half phones and cameras, and every one of them holds its
 * address on a lease. An authoritative zone describes what an administrator decided,
 * not what DHCP happened to hand out this morning — so the personal half of the
 * network is left out, and what remains is the part of the address plan that is
 * worth crossing a network to read.
 */
describe('which of a network the zone speaks for', () => {
  it('lists the routing gear and the servers, in address order', () => {
    // ACME-CORP, measured: three infrastructure hosts, three servers, one phone
    // (`iphone-62`) and one camera (`cam-138`). Written out rather than derived, so
    // that a change to the draw surfaces here instead of quietly agreeing with itself.
    expect(zoneRecordsFor('ACME-CORP')).toEqual([
      { name: 'switch-core', ip: '192.168.45.1' },
      { name: 'mikrotik01', ip: '192.168.45.40' },
      { name: 'records-52', ip: '192.168.45.52' },
      { name: 'db-192', ip: '192.168.45.192' },
      { name: 'firewall01', ip: '192.168.45.221' },
      { name: 'api-223', ip: '192.168.45.223' },
    ]);
  });

  it('keeps every machine that serves something and drops every one that does not', () => {
    const dropped: string[] = [];

    for (const essid of POPULATION_ESSIDS) {
      const listed = listedNamesOn(essid);
      const machines = machinesOn(essid);
      dropped.push(...hostnamesOf(machines.filter((host) => isPersonalDevice(host.hostname))));

      expect(hostnamesOf(machines.filter((host) => listed.has(host.hostname)))).toEqual(
        hostnamesOf(machines.filter((host) => !isPersonalDevice(host.hostname))),
      );
    }

    // Without this the sweep above passes just as happily on a sample that happened to
    // draw no phones at all, which would prove nothing about the rule it is here for.
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('keeps every gateway and switch, whose names claim no role at all', () => {
    // Routing gear is named from its own pool, so `roleOfHostname` answers nothing for
    // it — the filter has to read `kind`. ACME-CORP is the case that punishes reading
    // the name instead: its `.1` is CALLED `switch-core` and is a router, and its
    // `firewall01` is a switch.
    for (const essid of POPULATION_ESSIDS) {
      const listed = listedNamesOn(essid);
      const infrastructure = generateHomeLan(essid).hosts.filter((host) => host.kind !== 'machine');

      expect(hostnamesOf(infrastructure).map((name) => roleOfHostname(name))).toEqual(
        infrastructure.map(() => undefined),
      );
      expect(hostnamesOf(infrastructure.filter((host) => !listed.has(host.hostname)))).toEqual([]);
    }
  });

  it('gives every name the address its own network gives it', () => {
    // The zone is only worth reading if it is true. A name pointing at an address the
    // LAN does not agree with is worse than an absent one: a player acts on it.
    for (const essid of POPULATION_ESSIDS) {
      const addresses = new Map(
        generateHomeLan(essid).hosts.map((host) => [host.hostname, host.ip] as const),
      );

      for (const { name, ip } of zoneRecordsFor(essid)) expect(ip).toBe(addresses.get(name));
    }
  });
});
