import { describe, expect, it } from 'vitest';
import { reachServiceHost, type ServiceHostLookup } from './serviceHost';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { computeApGatewayId } from '../identity/router';
import { seedApGatewayHostname } from '../generation/gatewayHostname';
import { frontedSegment } from '../network/frontedSegment';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import { materializeWorkstationFs } from '../network/materializeWorkstationFs';
import { readOpenPorts, formatPidfileContent, pidfilePath } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { deepDatabaseFixture } from '../../test/factories/lanDatabase';
import { md5 } from '../generation/md5';
import { asAbsPath } from '../types';
import type { ApNetworkLookup, NatOccupantRow } from '../network/resolvePublicTarget';
import type { OwnerPatchRow } from '../network/materializeMachineFs';

/**
 * Reaching a box that serves a named daemon — the step every data door takes before
 * anything is asked of the box.
 *
 * Six doors share this one reach: the database login and every statement behind it,
 * the key-value connection and every statement behind that, and both agent
 * operations. They share it because their answers have to AGREE — a login that
 * consulted the pidfiles and a statement that did not would leave a prompt answering
 * queries against a daemon the player has already stopped.
 *
 * Which makes this the right level to test it. Proven only through whichever door
 * happened to exercise a vantage, a change here can alter the five doors nobody
 * re-read; proven here, all six inherit the same answer by construction.
 *
 * Four vantages, and the vantage is decided from the ADDRESS, server-side, never from
 * anything the client says about where it is standing:
 *
 *   - a generated box on the caller's own LAN, and the access point above it;
 *   - a FELLOW OCCUPANT of that same WiFi, where occupancy IS the reach;
 *   - a box on the hidden layer behind an inner gateway, reached through a forward;
 *   - somebody else's box across the world, reached by a public address.
 *
 * Five answers matter at each one, and they are what these tests hold still: which
 * box was found, the address it answers to FROM WHERE THE CALLER STANDS, the address
 * the box SAW the request arrive from, whose journal row its writes land under, and
 * which network its own forwards may point into.
 */

const ATTACKER = generateIdentity();
const ESSID = 'BEAN-THERE-WIFI';

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const patchRow = (path: string, content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: 'b'.repeat(64),
  }) as OwnerPatchRow;

/** Journals per machine, because a chain walk asks for one machine at a time and a
 *  stub answering the same rows for every id would hand a gateway's forward table to
 *  the box behind it as well. */
const journals = (rows: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  async ({ machine_id }: { readonly machine_id: string }) => ({
    data: rows[machine_id] ?? [],
    error: null,
  });

const makeLookup = (over: Partial<ServiceHostLookup> = {}): ServiceHostLookup => ({
  findNetworkByPublicIp: async () => ({ data: null, error: null }),
  findPatches: async () => ({ data: [], error: null }),
  listOccupantsByEssid: async () => ({ data: [], error: null }),
  listLeasesByEssid: async () => ({ data: [], error: null }),
  findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
  ...over,
});

// ─── the caller's own LAN: a generated sibling, and the access point above it ───

/** A generated box on the caller's own LAN that really serves something, with the
 *  service and port read off the generator rather than named here — a fixture that
 *  invented a port would prove the reach agrees with the fixture. */
const generatedHostOn = (
  essid: string,
): { readonly host: LanHost; readonly service: string; readonly port: number } => {
  for (const host of generateHomeLan(essid).hosts) {
    if (host.kind !== 'machine') continue;
    const [openPort] = readOpenPorts(resolveLanHostIdentity(host, essid).baseFs);
    if (openPort !== undefined) {
      return { host, service: openPort.service, port: openPort.port };
    }
  }
  throw new Error(`no generated host serves anything on ${essid}`);
};

const OWN_LAN = generatedHostOn(ESSID);
const OWN_LAN_IDENTITY = resolveLanHostIdentity(OWN_LAN.host, ESSID);

/** The access point's own gateway, reached from INSIDE the LAN it fronts. */
const apGatewayOn = (
  essid: string,
): { readonly host: LanHost; readonly service: string; readonly port: number } => {
  const host = generateHomeLan(essid).hosts.find((candidate) => octetOf(candidate) === 1);
  if (host === undefined) throw new Error(`no access point gateway on ${essid}`);
  const [openPort] = readOpenPorts(resolveLanHostIdentity(host, essid).baseFs);
  if (openPort === undefined) throw new Error(`the gateway on ${essid} serves nothing`);
  return { host, service: openPort.service, port: openPort.port };
};

const AP_GATEWAY = apGatewayOn(ESSID);

describe('reaching a generated box on the caller own LAN', () => {
  it('reaches the box without inventing a source address or a writer key', async () => {
    const reach = await reachServiceHost(makeLookup(), {
      essid: ESSID,
      targetIp: OWN_LAN.host.ip,
      service: OWN_LAN.service,
      port: OWN_LAN.port,
      actorKey: ATTACKER.publicKeyHex,
    });

    // On the caller's own LAN the address the box saw is the CALLER's, and only the
    // caller can state it — so this seam hands back `null` rather than a guess.
    expect(reach).toEqual({
      ok: true,
      reached: {
        hostname: OWN_LAN.host.hostname,
        machineId: OWN_LAN_IDENTITY.machineId,
        hostFs: expect.anything(),
        localIp: OWN_LAN.host.ip,
        sourceIp: null,
        writerKey: null,
        frontedSegment: frontedSegment({
          essid: ESSID,
          machineId: OWN_LAN_IDENTITY.machineId,
          kind: OWN_LAN.host.kind,
        }),
      },
    });
  });

  it('writes a generated box on the WiFi under that same stable key', async () => {
    const neighbour = generateIdentity();
    const reach = await reachServiceHost(
      makeLookup({
        listLeasesByEssid: async () => ({
          data: [
            { owner_key: ATTACKER.publicKeyHex, octet: 77 },
            { owner_key: neighbour.publicKeyHex, octet: 12 },
          ],
          error: null,
        }),
      }),
      {
        essid: ESSID,
        targetIp: OWN_LAN.host.ip,
        service: OWN_LAN.service,
        port: OWN_LAN.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // A generated sibling is as ESSID-shared as the gateway above it and the deep chain
    // behind it: regenerated from the ESSID, with an id that does not depend on who is
    // asking, so every occupant of this WiFi reaches the identical box. Filing each visit
    // under the caller's own key gives one box a row per attacker — and a log patch
    // carries the whole file, so replay keeps only whichever arrived last.
    //
    // The lowest lease is not a claim that its holder did anything; the visitor is named
    // in the line itself. It is the one bucket every caller agrees on, and it is read
    // back through the same resolver that chose it.
    expect(reach.ok && reach.reached.writerKey).toBe(neighbour.publicKeyHex);
  });

  it('writes the access point gateway under the lowest lease on the WiFi', async () => {
    const neighbour = generateIdentity();
    const reach = await reachServiceHost(
      makeLookup({
        listLeasesByEssid: async () => ({
          data: [
            { owner_key: ATTACKER.publicKeyHex, octet: 77 },
            { owner_key: neighbour.publicKeyHex, octet: 12 },
          ],
          error: null,
        }),
      }),
      {
        essid: ESSID,
        targetIp: AP_GATEWAY.host.ip,
        service: AP_GATEWAY.service,
        port: AP_GATEWAY.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // The gateway is reachable from inside the LAN as well as from the world, and one
    // box may not keep two logs: a row per writer means the newest wins outright on
    // replay, so an occupant walking their own gateway would erase the lines a
    // stranger's visit left there. The lowest lease is stable because leases outlive
    // occupancy and do not depend on the order the store returns rows.
    expect(reach.ok && reach.reached.machineId).toBe(computeApGatewayId(ESSID));
    expect(reach.ok && reach.reached.writerKey).toBe(neighbour.publicKeyHex);
  });

  it('leaves a gateway on a WiFi nobody has leased under the caller own key', async () => {
    const reach = await reachServiceHost(makeLookup(), {
      essid: ESSID,
      targetIp: AP_GATEWAY.host.ip,
      service: AP_GATEWAY.service,
      port: AP_GATEWAY.port,
      actorKey: ATTACKER.publicKeyHex,
    });

    expect(reach.ok && reach.reached.writerKey).toBe(null);
  });

  it('keeps the visit when the leases cannot be read, losing only the stable key', async () => {
    const neighbour = generateIdentity();
    const reach = await reachServiceHost(
      makeLookup({
        // Rows AND a failure, so the ERROR is what decides. A stub answering `null`
        // would prove nothing: an empty lease list yields the same absent key by a
        // different route, and the guard could be dropped unnoticed.
        listLeasesByEssid: async () => ({
          data: [{ owner_key: neighbour.publicKeyHex, octet: 12 }],
          error: { message: 'down' },
        }),
      }),
      {
        essid: ESSID,
        targetIp: AP_GATEWAY.host.ip,
        service: AP_GATEWAY.service,
        port: AP_GATEWAY.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // A log line is best-effort everywhere else too, and losing the stable key is
    // milder than losing the visit.
    expect(reach.ok).toBe(true);
    expect(reach.ok && reach.reached.writerKey).toBe(null);
  });

  it('refuses an address that names no host on this LAN', async () => {
    const reach = await reachServiceHost(makeLookup(), {
      essid: ESSID,
      targetIp: '192.168.99.99',
      service: OWN_LAN.service,
      port: OWN_LAN.port,
      actorKey: ATTACKER.publicKeyHex,
    });

    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('refuses a bricked box before the daemon is asked about', async () => {
    const reach = await reachServiceHost(
      makeLookup({
        findPatches: async () => ({ data: [patchRow('/boot/vmlinuz', null)], error: null }),
      }),
      {
        essid: ESSID,
        targetIp: OWN_LAN.host.ip,
        service: OWN_LAN.service,
        port: OWN_LAN.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // A box with its kernel removed is dark to every tool, so a dead machine cannot be
    // probed for what it used to hold.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('refuses a daemon that is not the one holding the reached port', async () => {
    const reach = await reachServiceHost(makeLookup(), {
      essid: ESSID,
      targetIp: OWN_LAN.host.ip,
      service: 'no-such-daemon',
      port: OWN_LAN.port,
      actorKey: ATTACKER.publicKeyHex,
    });

    // The port IS the address: a forward to sshd is not a door to the data behind it.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'service_not_running' } },
    });
  });

  it('answers a filtered port exactly as a port nothing ever served', async () => {
    const reach = await reachServiceHost(
      makeLookup({
        findPatches: async () => ({
          data: [patchRow('/etc/iptables/rules.v4', `deny ${OWN_LAN.port}\n`)],
          error: null,
        }),
      }),
      {
        essid: ESSID,
        targetIp: OWN_LAN.host.ip,
        service: OWN_LAN.service,
        port: OWN_LAN.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // Word for word what an unserved port gives. A refusal of its own would be an
    // oracle telling a scanner which ports are worth attacking.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'service_not_running' } },
    });
  });

  it('reports an unreadable journal as a failure rather than an empty box', async () => {
    const reach = await reachServiceHost(
      makeLookup({
        findPatches: async () => ({ data: null, error: { message: 'connection reset' } }),
      }),
      {
        essid: ESSID,
        targetIp: OWN_LAN.host.ip,
        service: OWN_LAN.service,
        port: OWN_LAN.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // Falling back to the seeded baseline would serve the box as it was the day the
    // world was generated, refusing an account the player added.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 500, body: { error: 'patches_lookup_failed' } },
    });
  });
});

// ─── the same WiFi: a fellow occupant, with nothing in between ───

const DEFENDER = generateIdentity();
const DEFENDER_OCTET = 84;
const DEFENDER_LAN_IP = lanAddressFor(ESSID, DEFENDER_OCTET);
const DEFENDER_MACHINE = 'workstation-c3d4e5f6';
const DEFENDER_HOSTNAME = 'nebuchadnezzar';
const ATTACKER_OCTET = 61;
const ATTACKER_LAN_IP = lanAddressFor(ESSID, ATTACKER_OCTET);

const defenderOccupant: NatOccupantRow = {
  owner_key: DEFENDER.publicKeyHex,
  workstation_machine_id: DEFENDER_MACHINE,
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_username: 'neo',
  workstation_root_hash: md5('correct-horse-battery-staple'),
};

const attackerOccupant: NatOccupantRow = {
  owner_key: ATTACKER.publicKeyHex,
  workstation_machine_id: 'workstation-a1b2c3d4',
  workstation_machine_name: 'trinity-box',
  workstation_username: 'trinity',
  workstation_root_hash: md5('a-different-password'),
};

/** The defender ran `sshd`, which is what puts a daemon on their box at all: a
 *  workstation nobody has started a service on serves nothing to the WiFi. */
const DEFENDER_SSH_PORT = SERVICE_CATALOG.ssh.defaultPort;
const defenderSshd = patchRow(
  pidfilePath(SERVICE_CATALOG.ssh),
  formatPidfileContent(SERVICE_CATALOG.ssh, DEFENDER_SSH_PORT),
);

/** The daemon name the box really answers with, read off the pidfile the defender's
 *  `sshd` wrote. Thrown rather than defaulted: a fixture that quietly substituted a
 *  catalog name would let the reach be tested against a box serving nothing. */
const defenderSshService = (): string => {
  const openPort = readOpenPorts(materializeWorkstationFs(defenderOccupant, [defenderSshd])).find(
    (candidate) => candidate.port === DEFENDER_SSH_PORT,
  );
  if (openPort === undefined) throw new Error('the defender box serves no ssh port');
  return openPort.service;
};

const DEFENDER_SSH_SERVICE = defenderSshService();

const SAME_LAN_LEASES: readonly LanLeaseRow[] = [
  { owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET },
  { owner_key: ATTACKER.publicKeyHex, octet: ATTACKER_OCTET },
];

const sameLanLookup = (over: Partial<ServiceHostLookup> = {}) =>
  makeLookup({
    findPatches: journals({ [DEFENDER_MACHINE]: [defenderSshd] }),
    listOccupantsByEssid: async () => ({
      data: [defenderOccupant, attackerOccupant],
      error: null,
    }),
    listLeasesByEssid: async () => ({ data: SAME_LAN_LEASES, error: null }),
    ...over,
  });

const reachSameLan = (lookup: ServiceHostLookup, targetIp: string = DEFENDER_LAN_IP) =>
  reachServiceHost(lookup, {
    essid: ESSID,
    targetIp,
    service: DEFENDER_SSH_SERVICE,
    port: DEFENDER_SSH_PORT,
    actorKey: ATTACKER.publicKeyHex,
  });

describe('reaching a fellow occupant of the same WiFi', () => {
  it('reaches their box, which sees the caller own leased address', async () => {
    const reach = await reachSameLan(sameLanLookup());

    // No router, no NAT and no forward in between, so the box really did see the
    // caller's own address — the LEASE the server issued, never a client claim, since
    // a defender's log is their evidence. The target's own key keeps ONE log on their
    // box however many neighbours touch it.
    expect(reach).toEqual({
      ok: true,
      reached: {
        hostname: DEFENDER_HOSTNAME,
        machineId: DEFENDER_MACHINE,
        hostFs: expect.anything(),
        localIp: DEFENDER_LAN_IP,
        sourceIp: ATTACKER_LAN_IP,
        writerKey: DEFENDER.publicKeyHex,
        frontedSegment: null,
      },
    });
  });

  it('shows a caller holding no occupancy row only the generated world', async () => {
    const reach = await reachSameLan(
      sameLanLookup({
        listOccupantsByEssid: async () => ({ data: [defenderOccupant], error: null }),
      }),
    );

    // The LAN boundary: you reach a box on a WiFi by being on that WiFi.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('loses a target who has left the WiFi, lease or no lease', async () => {
    const reach = await reachSameLan(
      sameLanLookup({
        listOccupantsByEssid: async () => ({ data: [attackerOccupant], error: null }),
      }),
    );

    // `nmcli disconnect` is the defence on this vantage. The lease outlives the
    // occupancy row deliberately, so the address is still theirs — but occupancy IS
    // the reach here.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('reaches nobody while the caller holds no lease of their own', async () => {
    const reach = await reachSameLan(
      sameLanLookup({
        listLeasesByEssid: async () => ({
          data: [{ owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET }],
          error: null,
        }),
      }),
    );

    // The target is plainly there, but a caller with no address on this LAN is one the
    // box could not have answered — and one whose attempt could only be logged at an
    // address the server would have to invent.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('does not hand the caller their own address as somebody to reach', async () => {
    const reach = await reachSameLan(sameLanLookup(), ATTACKER_LAN_IP);

    // Your own box is the client's own-box path, which reads the real filesystem in
    // front of the player rather than one rebuilt from an occupancy row.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('reports an unreadable occupancy as a failure, not an empty WiFi', async () => {
    const reach = await reachSameLan(
      sameLanLookup({
        // Readable rows alongside the failure, so only the guard can produce a 500:
        // with `null` the reach would refuse for want of an occupant instead.
        listOccupantsByEssid: async () => ({
          data: [defenderOccupant, attackerOccupant],
          error: { message: 'down' },
        }),
      }),
    );

    // Quietly dropping to the generated world would route a player's statements onto a
    // seeded box standing where a real player is, and write their data to it.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 500, body: { error: 'occupants_lookup_failed' } },
    });
  });

  it('reports unreadable leases as a failure, not an unaddressed LAN', async () => {
    const reach = await reachSameLan(
      sameLanLookup({
        listLeasesByEssid: async () => ({ data: SAME_LAN_LEASES, error: { message: 'down' } }),
      }),
    );

    expect(reach).toEqual({
      ok: false,
      refusal: { status: 500, body: { error: 'leases_lookup_failed' } },
    });
  });
});

// ─── the hidden layer behind an inner gateway ───

const DEEP = deepDatabaseFixture();
const DEEP_FORWARD_PORT = 33306;
const DEEP_SERVICE_PORT = SERVICE_CATALOG.mysql.defaultPort;
const DEEP_SERVICE = SERVICE_CATALOG.mysql.service;

const deepLookup = (
  destination = `${DEEP.layer.host.ip}:${DEEP_SERVICE_PORT}`,
  over: Partial<ServiceHostLookup> = {},
) =>
  makeLookup({
    findPatches: journals({
      [DEEP.gatewayMachineId]: [
        patchRow('/etc/iptables/rules.v4', `forward ${DEEP_FORWARD_PORT} to ${destination}`),
      ],
    }),
    ...over,
  });

const reachDeep = (lookup: ServiceHostLookup, port: number = DEEP_FORWARD_PORT) =>
  reachServiceHost(lookup, {
    essid: DEEP.essid,
    targetIp: DEEP.gateway.ip,
    service: DEEP_SERVICE,
    port,
    actorKey: ATTACKER.publicKeyHex,
  });

describe('reaching a box on the layer behind an inner gateway', () => {
  it('reaches the box the forward leads to, which sees only the fronting gateway', async () => {
    const reach = await reachDeep(deepLookup());

    // The typed address belongs to the GATEWAY. Reporting it back would name a box on
    // the LAN while answering for one two hops behind it — and a deep box behind NAT
    // is shown the fronting gateway's downstream `.1` and nothing else, so any other
    // source address would be evidence of a request it never received.
    expect(reach.ok).toBe(true);
    expect(reach.ok && reach.reached.hostname).toBe(DEEP.layer.host.hostname);
    expect(reach.ok && reach.reached.machineId).toBe(DEEP.machineId);
    expect(reach.ok && reach.reached.localIp).toBe(DEEP.layer.host.ip);
    expect(reach.ok && reach.reached.sourceIp).toBe(DEEP.natIp);
  });

  it('writes a deep box under the lowest lease on the WiFi it is generated from', async () => {
    const neighbour = generateIdentity();
    const reach = await reachDeep(
      deepLookup(undefined, {
        listLeasesByEssid: async () => ({
          data: [
            { owner_key: ATTACKER.publicKeyHex, octet: 77 },
            { owner_key: neighbour.publicKeyHex, octet: 12 },
          ],
          error: null,
        }),
      }),
    );

    // Nobody OWNS a deep box, but it is ESSID-shared and its id does not depend on who
    // is asking, so two players reaching one box write two rows for one path — and a log
    // patch carries the whole file, so replay takes the newest outright and the earlier
    // attacker's lines vanish. The caller's own key is stable per player and unstable
    // across them, which is precisely the bug; the lowest lease on the ESSID is stable
    // for everyone, because leases outlive occupancy and do not depend on row order.
    expect(reach.ok && reach.reached.writerKey).toBe(neighbour.publicKeyHex);
  });

  it('refuses a port the gateway forwards nowhere', async () => {
    const reach = await reachDeep(deepLookup(), DEEP_FORWARD_PORT + 1);

    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('refuses a forward that lands on a port no daemon holds', async () => {
    const reach = await reachDeep(deepLookup(`${DEEP.layer.host.ip}:9999`));

    // The forward names a real box, so the address is not dark — nothing is listening
    // where it lands. The same answer this reach gives on the caller's own LAN for the
    // same situation: depth does not change the words a player reads.
    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'service_not_running' } },
    });
  });
});

// ─── across the world: somebody else's public address ───

const TARGET_PUBLIC_IP = '203.0.113.9';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const AP_NETWORK: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };
const ATTACKER_PUBLIC_IP = '198.51.100.22';

const PUBLIC_DEFENDER_OCTET = 84;
const PUBLIC_DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, PUBLIC_DEFENDER_OCTET);
const PUBLIC_LEASES: readonly LanLeaseRow[] = [
  { owner_key: DEFENDER.publicKeyHex, octet: PUBLIC_DEFENDER_OCTET },
];

const REMOTE_GATEWAY = apGatewayOn(TARGET_ESSID);

const publicLookup = (over: Partial<ServiceHostLookup> = {}) =>
  makeLookup({
    findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: null }),
    listOccupantsByEssid: async () => ({ data: [defenderOccupant], error: null }),
    listLeasesByEssid: async () => ({ data: PUBLIC_LEASES, error: null }),
    findHomeNetworkByOwnerKey: async () => ({
      data: { public_ip: ATTACKER_PUBLIC_IP },
      error: null,
    }),
    ...over,
  });

describe('reaching a box by its public address', () => {
  it('reaches the access point gateway itself, showing only its public address', async () => {
    const reach = await reachServiceHost(publicLookup(), {
      essid: ESSID,
      targetIp: TARGET_PUBLIC_IP,
      service: REMOTE_GATEWAY.service,
      port: REMOTE_GATEWAY.port,
      actorKey: ATTACKER.publicKeyHex,
    });

    // The public address IS what this box answers to from outside; handing back its
    // internal one would tell a stranger the shape of a LAN they have not reached.
    // The gateway is ownerless, so its log accretes under the AP's stable key, and it
    // fronts the LAN its own address sits on.
    expect(reach).toEqual({
      ok: true,
      reached: {
        hostname: seedApGatewayHostname(TARGET_ESSID),
        machineId: AP_GATEWAY_ID,
        hostFs: expect.anything(),
        localIp: TARGET_PUBLIC_IP,
        sourceIp: ATTACKER_PUBLIC_IP,
        writerKey: DEFENDER.publicKeyHex,
        frontedSegment: generateHomeLan(TARGET_ESSID).subnet,
      },
    });
  });

  it('derives the source address server-side, whatever ESSID travelled with the request', async () => {
    const reach = await reachServiceHost(publicLookup(), {
      // The attacker's OWN network, which is the only ESSID their client can name and
      // which decides nothing about the box under attack.
      essid: ESSID,
      targetIp: TARGET_PUBLIC_IP,
      service: REMOTE_GATEWAY.service,
      port: REMOTE_GATEWAY.port,
      actorKey: ATTACKER.publicKeyHex,
    });

    expect(reach.ok && reach.reached.sourceIp).toBe(ATTACKER_PUBLIC_IP);
  });

  it('records an unknown source for an actor on no home network', async () => {
    const reach = await reachServiceHost(
      publicLookup({ findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }) }),
      {
        essid: ESSID,
        targetIp: TARGET_PUBLIC_IP,
        service: REMOTE_GATEWAY.service,
        port: REMOTE_GATEWAY.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // A false origin in a defender's log is worse than no origin, and the reach stands
    // regardless: a visit is not failed over a logging detail.
    expect(reach.ok && reach.reached.sourceIp).toBe('unknown');
  });

  it('reaches an occupant behind a forward their owner opened', async () => {
    const publicPort = 43306;
    const reach = await reachServiceHost(
      publicLookup({
        findPatches: journals({
          [AP_GATEWAY_ID]: [
            patchRow(
              '/etc/iptables/rules.v4',
              `forward ${publicPort} to ${PUBLIC_DEFENDER_LAN_IP}:${DEFENDER_SSH_PORT}`,
            ),
          ],
          [DEFENDER_MACHINE]: [defenderSshd],
        }),
      }),
      {
        essid: ESSID,
        targetIp: TARGET_PUBLIC_IP,
        service: DEFENDER_SSH_SERVICE,
        port: publicPort,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    // A box behind the NAT stands on the LAN and has nothing behind IT, so it fronts
    // no network at all — and its own owner's key is what its log accretes under.
    expect(reach).toEqual({
      ok: true,
      reached: {
        hostname: DEFENDER_HOSTNAME,
        machineId: DEFENDER_MACHINE,
        hostFs: expect.anything(),
        localIp: TARGET_PUBLIC_IP,
        sourceIp: ATTACKER_PUBLIC_IP,
        writerKey: DEFENDER.publicKeyHex,
        frontedSegment: null,
      },
    });
  });

  it('refuses a public address bearing no network', async () => {
    const reach = await reachServiceHost(
      publicLookup({ findNetworkByPublicIp: async () => ({ data: null, error: null }) }),
      {
        essid: ESSID,
        targetIp: TARGET_PUBLIC_IP,
        service: REMOTE_GATEWAY.service,
        port: REMOTE_GATEWAY.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('refuses a port nothing behind the address serves', async () => {
    const reach = await reachServiceHost(publicLookup(), {
      essid: ESSID,
      targetIp: TARGET_PUBLIC_IP,
      service: REMOTE_GATEWAY.service,
      port: 44444,
      actorKey: ATTACKER.publicKeyHex,
    });

    expect(reach).toEqual({
      ok: false,
      refusal: { status: 404, body: { error: 'host_unreachable' } },
    });
  });

  it('reports a network lookup failure as a failure rather than an empty world', async () => {
    const reach = await reachServiceHost(
      publicLookup({
        // A resolvable network alongside the failure: with `null` the reach would
        // refuse for want of a network and the guard could go unnoticed.
        findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: { message: 'down' } }),
      }),
      {
        essid: ESSID,
        targetIp: TARGET_PUBLIC_IP,
        service: REMOTE_GATEWAY.service,
        port: REMOTE_GATEWAY.port,
        actorKey: ATTACKER.publicKeyHex,
      },
    );

    expect(reach).toEqual({
      ok: false,
      refusal: { status: 500, body: { error: 'network_lookup_failed' } },
    });
  });
});
