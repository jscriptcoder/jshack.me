import { describe, expect, it, vi } from 'vitest';
import {
  handleResolvePublicScan,
  type ApNetworkLookup,
  type NatOccupantRow,
  type ResolvePublicScanDeps,
} from './resolvePublicScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeApGatewayId } from '../identity/router';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import { md5 } from '../generation/md5';
import { seedApGatewayHostname } from '../generation/routerFs';
import { formatNmapScanAggregate, KERN_LOG_OWNER, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { asGameTime } from '../types';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolvePublicScan` is the server-side resolution of one identity's
 * `nmap <public IP>` against the AP that bears it. The public IP belongs to the ESSID's
 * shared GATEWAY — access-point infrastructure, not anyone's property — so the scan
 * replays the gateway's journal over its seeded base to ask `canBoot` (a bricked
 * gateway takes the whole public IP dark) and reports what it exposes: its own seeded
 * `sshd:22` PLUS every live NAT forward on its `rules.v4`.
 *
 * A forward names an internal address, and the occupant answering to that address is
 * whoever LEASES it — so every occupant of a shared AP is forward-reachable, not merely
 * one of them, and each forward is gated on the liveness of its own target box.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
const ESSID = 'CoffeeShopWiFi';
// 2026-06-19 12:00:00 UTC — the server clock the kern.log trace is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
// The scanner's home public IP, as the server resolves it from their owner key.
// Server-derived; NEVER the client-supplied `source_ip`.
const SCANNER_PUBLIC_IP = '198.51.100.22';

// Two identities on ONE access point — the shape the whole NAT surface has to serve.
// Real identities so each occupant's box rebuilds from its own owner key.
const ALICE = generateIdentity();
const BOB = generateIdentity();

const ALICE_WS = 'workstation-a1b2c3d4';
const BOB_WS = 'workstation-b5c6d7e8';
// Alice holds the LOWER address — she joined first and the allocator offered it. Bob's
// lease is higher, which is exactly the case the old "one host behind the NAT" lookup
// could not reach.
const ALICE_OCTET = 84;
const BOB_OCTET = 112;
const ALICE_LAN_IP = lanAddressFor(ESSID, ALICE_OCTET);
const BOB_LAN_IP = lanAddressFor(ESSID, BOB_OCTET);

const aliceOccupant: NatOccupantRow = {
  owner_key: ALICE.publicKeyHex,
  workstation_machine_id: ALICE_WS,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
};
const bobOccupant: NatOccupantRow = {
  owner_key: BOB.publicKeyHex,
  workstation_machine_id: BOB_WS,
  workstation_username: 'trinity',
  workstation_root_hash: md5('nebuchadnezzar'),
};
const BOTH_OCCUPANTS: readonly NatOccupantRow[] = [aliceOccupant, bobOccupant];
const BOTH_LEASES: readonly LanLeaseRow[] = [
  { owner_key: ALICE.publicKeyHex, octet: ALICE_OCTET },
  { owner_key: BOB.publicKeyHex, octet: BOB_OCTET },
];

const AP_GATEWAY_ID = computeApGatewayId(ESSID);
const REGISTERED: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: ESSID };

/** A root `nano /etc/iptables/rules.v4` edit on the GATEWAY's journal — the opt-in that
 *  exposes a box behind the NAT. One file, one journal, every occupant's forwards. */
const forwards = (...lines: readonly string[]): OwnerPatchRow => ({
  path: '/etc/iptables/rules.v4',
  content: lines.join('\n'),
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:01.000Z',
  writer_key: ALICE.publicKeyHex,
});
const forwardTo = (publicPort: number, internalIp: string): string =>
  `forward ${publicPort} to ${internalIp}:22`;
const aliceForward = forwards(forwardTo(2222, ALICE_LAN_IP));
const bobForward = forwards(forwardTo(3333, BOB_LAN_IP));
const bothForwards = forwards(forwardTo(2222, ALICE_LAN_IP), forwardTo(3333, BOB_LAN_IP));

/** An occupant's `sshd` running — its pidfile planted on that WORKSTATION's journal.
 *  With it the forward is live; without it the box is dark behind the NAT. */
const sshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` tombstone — replayed over a machine's seeded base, it
 *  deletes the kernel so `canBoot` reports that box bricked. Dropped on the GATEWAY's
 *  journal it takes the whole public IP dark; dropped on an occupant's journal it drops
 *  only that occupant's forwards (the gateway still answers its own ports). */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
};

type LookupResult = { data: ApNetworkLookup | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };
type OccupantsResult = { data: readonly NatOccupantRow[] | null; error: unknown };
type LeasesResult = { data: readonly LanLeaseRow[] | null; error: unknown };
type OwnerKeyResult = { data: { public_ip: string } | null; error: unknown };

/** Route the journal read by machine id — the gateway's `rules.v4` and each occupant's
 *  running services live on different machines, read separately. */
const patchesByMachine =
  (byId: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> => ({
    data: byId[machine_id] ?? [],
    error: null,
  });

/** Defaults: the AP is registered with both occupants on it, holding the leases the
 *  allocator issued them; every journal is empty; the scanner's source IP resolves; the
 *  gateway's kern.log starts empty and the append succeeds. */
type ScanOverrides = {
  lookup?: (publicIp: string) => Promise<LookupResult>;
  patches?: (query: { machine_id: string }) => Promise<PatchesResult>;
  listOccupantsByEssid?: (essid: string) => Promise<OccupantsResult>;
  listLeasesByEssid?: (essid: string) => Promise<LeasesResult>;
  readLog?: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  findHomeNetworkByOwnerKey?: (ownerKey: string) => Promise<OwnerKeyResult>;
};

const makeDeps = (over: ScanOverrides = {}) => {
  const findNetworkByPublicIp = vi.fn<(publicIp: string) => Promise<LookupResult>>(
    over.lookup ?? (async () => ({ data: REGISTERED, error: null })),
  );
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
    over.patches ?? (async () => ({ data: [], error: null })),
  );
  const listOccupantsByEssid = vi.fn<(essid: string) => Promise<OccupantsResult>>(
    over.listOccupantsByEssid ?? (async () => ({ data: BOTH_OCCUPANTS, error: null })),
  );
  const listLeasesByEssid = vi.fn<(essid: string) => Promise<LeasesResult>>(
    over.listLeasesByEssid ?? (async () => ({ data: BOTH_LEASES, error: null })),
  );
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const findHomeNetworkByOwnerKey = vi.fn<(ownerKey: string) => Promise<OwnerKeyResult>>(
    over.findHomeNetworkByOwnerKey ??
      (async () => ({ data: { public_ip: SCANNER_PUBLIC_IP }, error: null })),
  );
  const deps: ResolvePublicScanDeps = {
    nonceStore: freshStore,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    now: () => FIXED_NOW,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
  };
  return {
    deps,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
  };
};

/** The kern.log line the server is expected to stamp on the GATEWAY record for a
 *  host-up cross-player scan at `FIXED_NOW`: the AP's ESSID-seeded hostname, the
 *  scanner's server-derived source IP, and the ports they actually saw. */
const expectedKernLine = (sourceIp: string, ports: readonly number[]): string =>
  formatNmapScanAggregate({
    time: asGameTime(FIXED_NOW),
    hostname: seedApGatewayHostname(ESSID),
    sourceIp,
    probedPorts: ports,
  });

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  target: string,
  over: Record<string, unknown> = {},
) => signRequest(id, 'resolvePublicScan', { target, ...over });

const SSH_22 = { port: 22, service: 'ssh' };

describe('handleResolvePublicScan', () => {
  it("resolves a registered public IP to the AP gateway's own sshd:22 (every occupant dark behind NAT)", async () => {
    const scanner = generateIdentity();
    const { deps, findNetworkByPublicIp, findPatches } = makeDeps();

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    // Exactly the gateway's own port — nothing from behind the NAT.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [SSH_22] },
    });
    expect(findNetworkByPublicIp).toHaveBeenCalledWith(TARGET);
    // The journal is read off the GATEWAY machine, not any occupant's.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: AP_GATEWAY_ID });
  });

  it('does not go looking for occupants or their journals when no forward is configured', async () => {
    const scanner = generateIdentity();
    const { deps, findPatches, listOccupantsByEssid } = makeDeps();

    await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    // A fresh AP exposes only the gateway; nothing behind the NAT is even asked about.
    expect(findPatches).toHaveBeenCalledTimes(1);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  describe('every occupant of a shared AP is forward-reachable', () => {
    it("surfaces a forward aimed at an occupant's leased address while their box is up", async () => {
      const scanner = generateIdentity();
      const { deps, findPatches, listOccupantsByEssid } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      // The gateway's own :22 PLUS the live forward, mapped to its public port :2222.
      expect(result.body).toMatchObject({ ports: [SSH_22, { port: 2222, service: 'ssh' }] });
      expect(listOccupantsByEssid).toHaveBeenCalledWith(ESSID);
      // The forward's liveness is gated on the OCCUPANT's journal, read separately.
      expect(findPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS });
    });

    it('reads only the journals of the boxes a forward actually names', async () => {
      const scanner = generateIdentity();
      const { deps, findPatches } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
      });

      await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      // An AP can carry many occupants and one forward. Fetching every occupant's
      // journal to answer a question about one address costs a read per occupant.
      expect(findPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS });
      expect(findPatches).not.toHaveBeenCalledWith({ machine_id: BOB_WS });
    });

    it('surfaces the forward of an occupant who joined LATER than another — the AP has no single host behind its NAT', async () => {
      const scanner = generateIdentity();
      const { deps, findPatches } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ ports: [SSH_22, { port: 3333, service: 'ssh' }] });
      // Bob's box is the one that was read — the forward names his address, so he is
      // who answers, regardless of who else is on the AP or who joined when.
      expect(findPatches).toHaveBeenCalledWith({ machine_id: BOB_WS });
    });

    it("surfaces EVERY occupant's forward at once", async () => {
      const scanner = generateIdentity();
      const { deps } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [bothForwards],
          [ALICE_WS]: [sshdUp],
          [BOB_WS]: [sshdUp],
        }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({
        ports: [SSH_22, { port: 2222, service: 'ssh' }, { port: 3333, service: 'ssh' }],
      });
    });

    it("gates each forward on ITS OWN box's liveness, not on any other occupant's", async () => {
      const scanner = generateIdentity();
      // Both forwards published; only Alice started sshd. Bob's box is up but idle.
      const { deps } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [bothForwards],
          [ALICE_WS]: [sshdUp],
          [BOB_WS]: [],
        }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ ports: [SSH_22, { port: 2222, service: 'ssh' }] });
    });

    it("hides a forward to an occupant whose box is bricked, even though its sshd pidfile lingers, while the AP's other forwards stand", async () => {
      const scanner = generateIdentity();
      const { deps } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [bothForwards],
          [ALICE_WS]: [sshdUp],
          [BOB_WS]: [sshdUp, bootTombstone],
        }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ ports: [SSH_22, { port: 2222, service: 'ssh' }] });
    });

    it('hides a forward aimed at an address nobody on the AP leases', async () => {
      const scanner = generateIdentity();
      const { deps } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [forwards(forwardTo(2222, lanAddressFor(ESSID, 251)))],
          [ALICE_WS]: [sshdUp],
        }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ ports: [SSH_22] });
    });

    it('hides a forward aimed at a lease whose holder has left the WiFi — a lease outlives occupancy, reachability does not', async () => {
      const scanner = generateIdentity();
      // Bob's lease is permanent and still names his address, but he ran `nmcli
      // disconnect`, so he is no longer an occupant and his box is on no network.
      const { deps } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
        listOccupantsByEssid: async () => ({ data: [aliceOccupant], error: null }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ ports: [SSH_22] });
    });

    it('hides a forward aimed at an occupant who holds no lease at all', async () => {
      const scanner = generateIdentity();
      const { deps } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
        listLeasesByEssid: async () => ({
          data: [{ owner_key: ALICE.publicKeyHex, octet: ALICE_OCTET }],
          error: null,
        }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ ports: [SSH_22] });
    });
  });

  it("reports a server error when an occupant's journal lookup fails", async () => {
    const scanner = generateIdentity();
    const { deps } = makeDeps({
      patches: async ({ machine_id }) =>
        machine_id === ALICE_WS
          ? { data: null, error: new Error('ws db down') }
          : { data: [aliceForward], error: null },
    });

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports a server error when the occupant list lookup fails — never guesses who is behind a forward', async () => {
    const scanner = generateIdentity();
    const { deps } = makeDeps({
      patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
      listOccupantsByEssid: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupants_lookup_failed' } });
  });

  it('reports a server error when the lease lookup fails — never guesses an address', async () => {
    const scanner = generateIdentity();
    const { deps } = makeDeps({
      patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
      listLeasesByEssid: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'leases_lookup_failed' } });
  });

  it('reports a bricked AP gateway (a /boot tombstone on its journal) as host down, with no ports', async () => {
    const scanner = generateIdentity();
    const { deps, findPatches } = makeDeps({
      patches: async () => ({ data: [bootTombstone], error: null }),
    });

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    // Host-down shape — indistinguishable from an unregistered IP (the client maps
    // `found: false` to "Host seems down").
    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: AP_GATEWAY_ID });
  });

  it('reports a server error when the boot-state patch lookup fails', async () => {
    const scanner = generateIdentity();
    const { deps } = makeDeps({ patches: async () => ({ data: null, error: new Error('db down') }) });

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports an unregistered public IP as not found, with no ports', async () => {
    const scanner = generateIdentity();
    const { deps, findPatches } = makeDeps({ lookup: async () => ({ data: null, error: null }) });

    const result = await handleResolvePublicScan(envelope(scanner, '203.0.113.99'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    // No AP row → no gateway to check; the journal read is skipped.
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports a server error when the network lookup fails', async () => {
    const scanner = generateIdentity();
    const { deps } = makeDeps({ lookup: async () => ({ data: null, error: new Error('db down') }) });

    const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'network_lookup_failed' } });
  });

  it('rejects a tampered envelope without looking anything up', async () => {
    const scanner = generateIdentity();
    const { deps, findNetworkByPublicIp } = makeDeps();
    const signed = envelope(scanner, TARGET);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolvePublicScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const scanner = generateIdentity();
    const { deps, findNetworkByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(
      envelope(scanner, TARGET, { player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const scanner = generateIdentity();
    const { deps, findNetworkByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(
      signRequest(scanner, 'resolvePublicScan', {}),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  // A host-up cross-player scan leaves a truthful kern.log trace on the AP GATEWAY's
  // shared record. The keystone: the line is NOT written under the scanner's key — the
  // system owns its logs, so every scanner's line accretes into ONE row instead of
  // colliding under the last-write-wins fold; the scanner's identity lives in the line
  // content (source IP).
  describe('cross-player scan trace', () => {
    it('appends ONE kern.log line on the GATEWAY record for a host-up scan', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps();

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      // The scan result is unchanged by the logging.
      expect(result).toEqual({
        status: 200,
        body: { ok: true, found: true, ports: [SSH_22] },
      });
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0]).toEqual({
        writer_key: ALICE.publicKeyHex,
        machine_id: AP_GATEWAY_ID,
        path: '/var/log/kern.log',
        content: `${expectedKernLine(SCANNER_PUBLIC_IP, [22])}\n`,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
        node_type: 'file',
      });
      // The provenance is never the scanner — the keystone.
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(scanner.publicKeyHex);
    });

    it("accretes the AP's log under ONE row whatever order the leases come back in", async () => {
      const scanner = generateIdentity();
      const reversed = makeDeps({
        listLeasesByEssid: async () => ({ data: [...BOTH_LEASES].reverse(), error: null }),
      });

      await handleResolvePublicScan(envelope(scanner, TARGET), reversed.deps);

      // The gateway belongs to nobody, so its log has to accrete under SOME occupant's
      // row — and it must be the same one every time. A writer_key that moves splits the
      // log across rows, and the later row erases the earlier one on replay.
      expect(reversed.upsertPatch.mock.calls[0]![0].writer_key).toBe(ALICE.publicKeyHex);
    });

    it('lists every port the scanner actually saw, including live NAT forwards', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [bothForwards],
          [ALICE_WS]: [sshdUp],
          [BOB_WS]: [sshdUp],
        }),
      });

      await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(upsertPatch.mock.calls[0]![0].content).toBe(
        `${expectedKernLine(SCANNER_PUBLIC_IP, [22, 2222, 3333])}\n`,
      );
    });

    it("uses the scanner's OCCUPANT public IP as the source, ignoring a client-supplied source_ip", async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch, findHomeNetworkByOwnerKey } = makeDeps();

      await handleResolvePublicScan(envelope(scanner, TARGET, { source_ip: '10.0.0.66' }), deps);

      // The lookup is keyed by the SCANNER's verified key, not any occupant.
      expect(findHomeNetworkByOwnerKey).toHaveBeenCalledWith(scanner.publicKeyHex);
      const content = upsertPatch.mock.calls[0]![0].content;
      expect(content).toContain(`from ${SCANNER_PUBLIC_IP}`);
      expect(content).not.toContain('10.0.0.66');
    });

    it("falls back to 'unknown' source when the scanner has no home network, still logging and succeeding", async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body.found).toBe(true);
      expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedKernLine('unknown', [22])}\n`);
    });

    it('reports the scan truthfully but leaves no trace on an AP nobody has ever leased an address on', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        listLeasesByEssid: async () => ({ data: [], error: null }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body).toMatchObject({ found: true, ports: [SSH_22] });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes nothing for an unregistered public IP (found:false)', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps({ lookup: async () => ({ data: null, error: null }) });

      const result = await handleResolvePublicScan(envelope(scanner, '203.0.113.99'), deps);

      expect(result.body.found).toBe(false);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes nothing for a bricked gateway (found:false)', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        patches: async () => ({ data: [bootTombstone], error: null }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body.found).toBe(false);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('skips the write when the log read fails (RMW bails), and still returns the scan', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        readLog: async () => ({ data: null, error: new Error('log read down') }),
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result).toEqual({
        status: 200,
        body: { ok: true, found: true, ports: [SSH_22] },
      });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns the scan even when the log write throws (best-effort logging)', async () => {
      const scanner = generateIdentity();
      const { deps } = makeDeps({
        upsertPatch: async () => {
          throw new Error('write blew up');
        },
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result).toEqual({
        status: 200,
        body: { ok: true, found: true, ports: [SSH_22] },
      });
    });
  });
});
