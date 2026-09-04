import { describe, expect, it } from 'vitest';
import { lanZoneName, resolveLanName } from '../network/resolveName';
import { buildDirectory } from '../../test/factories/filesystem';
import { resolveDeepScanHosts } from '../scan/deepScanHosts';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { crackableEssidPool } from './generateWifi';
import { chainLinks } from './lanTopology';
import { roleOfHostname } from './pools/hostnames';
import {
  allowsZoneTransfer,
  formatDnsZone,
  formatNamedConf,
  zoneFilePathFor,
  zoneRecordsFor,
  type ZoneRecord,
} from './generateDnsZone';

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

  it('renders the whole file, line for line, as a resolver would be handed it', () => {
    // The golden vector. Every other test in this block asks the file ONE question and
    // stays green while the rest of it drifts — a header emptying, the SOA block losing
    // its alignment, the record column collapsing. Nothing here is generated from the
    // formatter: it is written out as BIND syntax and the formatter has to match it.
    expect(zoneOf()).toEqual([
      '; Zone file for acme-corp.lan',
      '$ORIGIN acme-corp.lan.',
      '$TTL 3600',
      '',
      '@  IN SOA ns-20.acme-corp.lan. hostmaster.acme-corp.lan. (',
      '     2024030101 ; serial',
      '     3600       ; refresh',
      '     1800       ; retry',
      '     604800     ; expire',
      '     86400      ; minimum',
      ')',
      '@  IN NS  ns-20.acme-corp.lan.',
      '',
      '; A records',
      'ns-20           3600  IN  A  192.168.42.20',
      'web-4           3600  IN  A  192.168.42.4',
      'switch-core     3600  IN  A  192.168.42.48',
    ]);
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

/** The zone's home-LAN records only, picked out by subnet. The deep half answers to a
 *  different rule and is asserted separately; selecting by address rather than by
 *  position also means a deep host that happened to share a name with a dropped one
 *  cannot make an exclusion look satisfied. */
const homeLanRecordsOn = (essid: string): readonly ZoneRecord[] => {
  const { subnet } = generateHomeLan(essid);
  return zoneRecordsFor(essid).filter(({ ip }) => ip.startsWith(`${subnet}.`));
};

const listedNamesOn = (essid: string): ReadonlySet<string> =>
  new Set(homeLanRecordsOn(essid).map(({ name }) => name));

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
    expect(homeLanRecordsOn('ACME-CORP')).toEqual([
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

      for (const { name, ip } of homeLanRecordsOn(essid)) expect(ip).toBe(addresses.get(name));
    }
  });

  it('lists the name server itself, on the two networks that keep one on this segment', () => {
    // The role that makes the whole door work was the one role never checked here: only
    // two of the fifty crackable networks put their name server on Layer 1, and neither
    // is in the sample above. A zone whose NS line names a host it carries no address
    // for is a broken zone — the player reads the file ON the box and cannot find the
    // box. Everywhere else the server is deep, where nothing is filtered by role at all,
    // which is exactly why the gap could sit here unnoticed.
    expect(homeLanRecordsOn('OSCORP-GUEST')).toContainEqual({
      name: 'bind-224',
      ip: '192.168.118.224',
    });
    expect(homeLanRecordsOn('DEFCON-VILLAGE')).toContainEqual({
      name: 'resolver-69',
      ip: '192.168.97.69',
    });
  });
});

/** A vantage tree with nothing in it. The scan resolver reads a switch's `acl.conf`
 *  from here to filter PORTS, and ports are not what is being compared — the zone
 *  carries addresses, and an absent ACL denies nothing. */
const NO_VANTAGE_TREE = buildDirectory();

const scannedHostsOn = (essid: string): readonly LanHost[] =>
  chainLinks(essid).flatMap((link) =>
    resolveDeepScanHosts(
      essid,
      { machineId: link.machineId, kind: link.host.kind, hangsChild: link.hangsChild },
      NO_VANTAGE_TREE,
    ).hosts.map(({ host }) => host),
  );

/**
 * The half of the zone that is worth crossing a network for. A deep layer holds exactly
 * one machine, at a fixed address, behind a gateway an administrator configured — that
 * is infrastructure however the role dice named it, so nothing down here is filtered.
 * It is also the half no scan of the player's own segment could have shown them.
 */
describe('what the zone says about the layers behind the gateways', () => {
  it('carries every host a pivot scan of each layer would report', () => {
    let compared = 0;

    for (const essid of POPULATION_ESSIDS) {
      const listed = zoneRecordsFor(essid);

      // Compared against the resolver the pivot scan itself renders from, not against a
      // second reading of the generator. A zone naming an address the scan of that same
      // layer does not is worse than one naming nothing: a player acts on it.
      for (const host of scannedHostsOn(essid)) {
        expect(listed).toContainEqual({ name: host.hostname, ip: host.ip });
        compared += 1;
      }
    }

    expect(compared).toBeGreaterThan(POPULATION_ESSIDS.length);
  });

  it('lists the home LAN first and then each layer in the order the chain reaches it', () => {
    // ACME-CORP, measured end to end. Six on the home LAN by address, then four deep
    // layers in chain order: two behind `mikrotik01` (the NPC and the gateway to the
    // next layer), two behind that gateway, one behind ITS gateway where the depth
    // bound stops the chain, and one behind the switch, which forwards nothing and so
    // fronts no child. Four distinct `10.x` prefixes is what depth looks like from
    // outside — and the whole point of the file is that the last six lines are the part
    // no scan of the player's own segment could have told them.
    expect(zoneRecordsFor('ACME-CORP').map(({ ip }) => ip)).toEqual([
      '192.168.45.1',
      '192.168.45.40',
      '192.168.45.52',
      '192.168.45.192',
      '192.168.45.221',
      '192.168.45.223',
      '10.207.205.87',
      '10.207.205.94',
      '10.56.37.65',
      '10.56.37.179',
      '10.35.196.137',
      '10.34.191.189',
    ]);
  });

  it('keeps the cameras down here that it left off the home LAN', () => {
    const names = zoneRecordsFor('ACME-CORP').map(({ name }) => name);

    // The same kind of device, in on one layer and out on another, and the difference is
    // the network rather than the box: a home LAN hands its phones and cameras DHCP
    // leases, while a deep host sits at an address somebody chose. Three of ACME-CORP's
    // four deep hosts are cameras and doorbells and televisions, and dropping them would
    // empty most of the file.
    expect(names).not.toContain('cam-138');
    expect(names).toEqual(expect.arrayContaining(['doorbell-87', 'tv-137', 'cam-189']));
  });
});

/** The network slice 3 will demo on, and one of the eight in the crackable pool whose
 *  draw put a single name on two hosts. Named rather than searched for, so a change to
 *  the draw surfaces here instead of quietly picking a different network. */
const COLLIDING_ESSID = 'GRAD-STUDENT-WIFI';

/**
 * One name, two hosts. It reads like a bug and it is not: two A records under a single
 * name is round-robin, which is ordinary DNS and which real networks run deliberately.
 * The risk is the FIX — a later pass that treats the name as a key would drop an address
 * a player can reach, silently, with nothing else in the file looking wrong.
 */
describe('a name that two hosts on one network answer to', () => {
  it('lists both addresses instead of choosing between them', () => {
    const zone = lanZoneName(COLLIDING_ESSID);
    const lines = formatDnsZone({
      zone,
      nameserver: 'ns-116',
      records: zoneRecordsFor(COLLIDING_ESSID),
    }).split('\n');

    // GRAD-STUDENT-WIFI, measured: the gateway at .1 and another router at .18 both drew
    // `router01`. The second address is the one a player could not have reached any other
    // way, and it is only in the file because the name was not used to key the zone.
    expect(aRecords(lines).filter(({ name }) => name === 'router01')).toEqual([
      { name: 'router01', ip: '192.168.112.1' },
      { name: 'router01', ip: '192.168.112.18' },
    ]);
  });

  it('resolves the shared name to one of the addresses the zone lists', () => {
    const listed = zoneRecordsFor(COLLIDING_ESSID)
      .filter(({ name }) => name === 'router01')
      .map(({ ip }) => ip);

    // A resolver answering with an address the zone does not carry would make the file
    // worthless to read: the player would have crossed a network for a second opinion.
    // One answer out of two listed is what a round-robin name is SUPPOSED to give.
    expect(listed).toContain(resolveLanName(COLLIDING_ESSID, 'router01')?.ip);
  });

  it('never collapses two hosts into one record, on any network in the pool', () => {
    const collided: string[] = [];

    for (const essid of crackableEssidPool) {
      const records = zoneRecordsFor(essid);
      const addresses = records.map(({ ip }) => ip);

      // The address is what identifies a host here; the name is not. Every host the zone
      // speaks for gets its own line, whatever it happens to be called.
      expect(new Set(addresses).size).toBe(addresses.length);

      if (new Set(records.map(({ name }) => name)).size !== records.length) {
        collided.push(essid);
      }
    }

    // The sweep is only worth running because the world produces the case: eight of the
    // fifty crackable networks put one name on two hosts. A zone keyed by name would
    // empty this list while every assertion above it still passed.
    expect(collided.length).toBeGreaterThan(4);
  });
});

/** Enough (network, address) pairs to see a rate rather than a run of luck — the same
 *  shape every other generation-time probability in this repository is measured over. */
const TRANSFER_POPULATION: readonly boolean[] = POPULATION_ESSIDS.flatMap((essid) =>
  Array.from({ length: 253 }, (_unused, index) =>
    allowsZoneTransfer(essid, `192.168.1.${index + 2}`),
  ),
);

const confFor = (allowsTransfer: boolean): readonly string[] =>
  formatNamedConf({ hostname: 'ns-20', zone: ZONE, allowsTransfer }).split('\n');

/**
 * The file beside the zone: what the box is CONFIGURED to serve, as against what it
 * happens to be serving. A player reads it first because it is shorter, and it tells
 * them two things the zone cannot — the path of the zone file, and whether this server
 * will hand the whole thing over to anyone who asks.
 */
describe('the config a name server publishes about itself', () => {
  it('declares exactly one zone, the network of the box it sits on', () => {
    const lines = confFor(true);

    expect(lines.filter((line) => line.startsWith('zone '))).toEqual([`zone "${ZONE}" {`]);
    expect(lines).toContain('  type master;');
  });

  it('points at the file that actually holds the zone', () => {
    // Stated once, here, and read by whatever writes the zone out. A config naming a
    // path nothing wrote would be a name server describing a file that is not there.
    expect(confFor(true)).toContain(`  file "${zoneFilePathFor(ZONE)}";`);
    expect(zoneFilePathFor(ZONE)).toBe('/etc/bind/zones/db.acme-corp.lan');
  });

  it('answers for its own zone and refuses to go looking further', () => {
    const lines = confFor(true);

    // Authoritative, not a resolver. There is no DNS in this world beyond the LAN a
    // box stands on, so a config advertising recursion would invite a player to ask it
    // a question nothing can answer.
    expect(lines).toContain('  recursion no;');
    expect(lines).toContain('  allow-query { any; };');
    expect(lines).toContain('  listen-on port 53 { any; };');
  });

  it('says in one line whether the whole zone is there for the asking', () => {
    // The single line slice 3 turns into a mechanic, and the one a player is reading
    // this file to find.
    expect(confFor(true)).toContain('  allow-transfer { any; };');
    expect(confFor(false)).toContain('  allow-transfer { none; };');
  });

  it('renders the whole config, line for line, as bind9 would be handed it', () => {
    // The other golden vector, and the same argument: the questions above are about
    // single lines, and a config can be wrong in the space between them. Written as
    // named.conf syntax first — `options` then one `zone` block, every statement
    // semicolon-terminated — with the formatter required to match.
    expect(confFor(true)).toEqual([
      '// named.conf — ns-20',
      'options {',
      '  directory "/var/cache/bind";',
      '  listen-on port 53 { any; };',
      '  recursion no;',
      '  allow-query { any; };',
      '};',
      '',
      'zone "acme-corp.lan" {',
      '  type master;',
      '  file "/etc/bind/zones/db.acme-corp.lan";',
      '  allow-transfer { any; };',
      '};',
    ]);
  });

  it('leaves the transfer open on roughly three name servers in four', () => {
    const open = TRANSFER_POPULATION.filter(Boolean).length;

    // Open is the common case on purpose: a server locked down every time would make the
    // door a coin flip a player cannot influence, and the point of the misconfigured
    // majority is that it is the misconfiguration real networks actually have.
    expect(open / TRANSFER_POPULATION.length).toBeGreaterThan(0.7);
    expect(open / TRANSFER_POPULATION.length).toBeLessThan(0.8);
  });

  it('gives one box one answer, on every reload and for every occupant', () => {
    // Seeded from the network and the address and nothing else — the signature carries
    // no identity, so two players standing on one ESSID cannot be told different things
    // about the same server. A box that opened on one reload and closed on the next
    // would make the find unrepeatable and the failure unexplainable.
    expect(allowsZoneTransfer('ACME-CORP', '192.168.45.52')).toBe(
      allowsZoneTransfer('ACME-CORP', '192.168.45.52'),
    );
    expect(new Set(TRANSFER_POPULATION).size).toBe(2);
  });
});
