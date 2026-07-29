import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionPublic,
  type ApNetworkLookup,
  type AuthCreateSessionPublicDeps,
  type NatOccupantRow,
} from './authCreateSessionPublic';
import type { AuthSessionRow } from './authCreateSession';
import { md5 } from '../generation/md5';
import { seedApGatewayAdminPw, seedApGatewayHostname } from '../generation/routerFs';
import { workstationGuestPassword } from '../generation/workstationFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeApGatewayId } from '../identity/router';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import { asGameTime } from '../types';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthCreateSessionPublic` is the cross-player ssh-login gate: it routes by
 * DESTINATION PORT behind an AP's public IP. A port the shared GATEWAY itself serves
 * (its seeded `:22`) lands on the gateway, validated against its ESSID-seeded admin
 * password. A NAT-forwarded port lands on the occupant who LEASES the address that
 * forward names — so every occupant of a shared AP can publish a working forward, and
 * two forwards on one gateway reach two different boxes. Anything else is unreachable.
 *
 * A bricked gateway takes the whole public IP dark before any password is checked.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
const ESSID = 'BEAN-THERE-WIFI';
// 2026-06-19 12:00:00 UTC — the server clock the auth.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
// The attacker's home public IP, as the server resolves it from their owner key.
// Server-derived; NEVER the client-supplied `source_ip`.
const ATTACKER_PUBLIC_IP = '198.51.100.22';

// Two identities on ONE access point. The gateway's admin password seeds from the
// ESSID alone; each occupant's own accounts seed from that occupant's owner key.
const ALICE = generateIdentity();

/** An identity whose guest password is NOT `password`. Tests below turn on one
 *  occupant's credential being WRONG on the other occupant's box, so Alice and Bob
 *  must differ. The guest pool is eight words wide and these identities are random,
 *  so two independent draws collide about one run in eight — which failed those tests
 *  for a reason they were not testing. Drawing again removes the coincidence without
 *  weakening what they assert. */
const identityWithGuestPasswordOtherThan = (
  password: string,
): ReturnType<typeof generateIdentity> => {
  const candidate = generateIdentity();
  return workstationGuestPassword(candidate.publicKeyHex) === password
    ? identityWithGuestPasswordOtherThan(password)
    : candidate;
};

const BOB = identityWithGuestPasswordOtherThan(workstationGuestPassword(ALICE.publicKeyHex));

const AP_GATEWAY_ID = computeApGatewayId(ESSID);
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
  workstation_machine_name: 'nebuchadnezzar',
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
};
const bobOccupant: NatOccupantRow = {
  owner_key: BOB.publicKeyHex,
  workstation_machine_id: BOB_WS,
  workstation_machine_name: 'logos',
  workstation_username: 'trinity',
  workstation_root_hash: md5('root2'),
};
const BOTH_OCCUPANTS: readonly NatOccupantRow[] = [aliceOccupant, bobOccupant];
const BOTH_LEASES: readonly LanLeaseRow[] = [
  { owner_key: ALICE.publicKeyHex, octet: ALICE_OCTET },
  { owner_key: BOB.publicKeyHex, octet: BOB_OCTET },
];

const REGISTERED: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: ESSID };
const ADMIN_PW = seedApGatewayAdminPw(ESSID);
const ALICE_GUEST_PW = workstationGuestPassword(ALICE.publicKeyHex);
const BOB_GUEST_PW = workstationGuestPassword(BOB.publicKeyHex);

/** A root `nano /etc/iptables/rules.v4` edit on the GATEWAY's journal — the opt-in that
 *  exposes a box behind the NAT. One file, one journal, every occupant's forwards. */
const forwards = (...lines: readonly string[]): OwnerPatchRow => ({
  path: '/etc/iptables/rules.v4',
  content: lines.join('\n'),
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
});
const forwardTo = (publicPort: number, internalIp: string, internalPort = 22): string =>
  `forward ${publicPort} to ${internalIp}:${internalPort}`;
const aliceForward = forwards(forwardTo(2222, ALICE_LAN_IP));
const bobForward = forwards(forwardTo(3333, BOB_LAN_IP));
const bothForwards = forwards(forwardTo(2222, ALICE_LAN_IP), forwardTo(3333, BOB_LAN_IP));

/** An occupant started their sshd — the pidfile on that workstation's journal makes
 *  `:22` a live service (a fresh box has an empty `/var/run`, so a forward to it is
 *  dark until). */
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
 *  deletes the kernel so `canBoot` reports that box bricked. On the GATEWAY's journal it
 *  takes the whole public IP dark; on an occupant's it darkens only that box. */
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

/** Route the per-machine journal read by `machine_id`: the gateway's forward table and
 *  each occupant's running services live on different machines. */
const patchesByMachine =
  (byId: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> => ({
    data: byId[machine_id] ?? [],
    error: null,
  });

/** Defaults: the AP is registered with both occupants on it, holding the leases the
 *  allocator issued them; every journal is empty; the insert succeeds; the attacker's
 *  source IP resolves; the target's auth.log starts empty and the append succeeds. */
type AuthOverrides = {
  lookup?: (publicIp: string) => Promise<LookupResult>;
  patches?: (query: { machine_id: string }) => Promise<PatchesResult>;
  listOccupantsByEssid?: (essid: string) => Promise<OccupantsResult>;
  listLeasesByEssid?: (essid: string) => Promise<LeasesResult>;
  insert?: (row: AuthSessionRow) => Promise<{ error: unknown }>;
  now?: () => number;
  readAuthLog?: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  findHomeNetworkByOwnerKey?: (ownerKey: string) => Promise<OwnerKeyResult>;
};

const makeDeps = (over: AuthOverrides = {}) => {
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
  const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(
    over.insert ?? (async () => ({ error: null })),
  );
  const readAuthLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readAuthLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const findHomeNetworkByOwnerKey = vi.fn<(ownerKey: string) => Promise<OwnerKeyResult>>(
    over.findHomeNetworkByOwnerKey ??
      (async () => ({ data: { public_ip: ATTACKER_PUBLIC_IP }, error: null })),
  );
  const deps: AuthCreateSessionPublicDeps = {
    nonceStore: freshStore,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    insertSession,
    now: over.now ?? (() => FIXED_NOW),
    readAuthLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
  };
  return {
    deps,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    insertSession,
    readAuthLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
  };
};

const envelope = (id: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(id, 'authCreateSessionPublic', {
    session_id: 'ssh-root-1',
    target: TARGET,
    parent_session_id: 'seed-session',
    source_ip: '192.168.1.5',
    ...fields,
  });

/** The sshd auth.log line the server is expected to stamp for a cross-player attempt at
 *  `FIXED_NOW`, given the resolved machine's hostname + outcome + user. The source IP
 *  defaults to the attacker's server-derived home public IP. */
const expectedSshdLine = (
  hostname: string,
  outcome: 'success' | 'failure',
  user: string,
  fromIp: string = ATTACKER_PUBLIC_IP,
): string =>
  formatSshdAuthLine({
    outcome,
    user,
    fromIp,
    hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

describe('handleAuthCreateSessionPublic', () => {
  it("authenticates root against the shared AP gateway (default port 22) and inserts a session on the gateway's machine id", async () => {
    const attacker = generateIdentity();
    const { deps, findNetworkByPublicIp, findPatches, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'root', machine_id: AP_GATEWAY_ID });
    expect(findNetworkByPublicIp).toHaveBeenCalledWith(TARGET);
    // The journal is read off the GATEWAY machine, not any occupant's.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: AP_GATEWAY_ID });
    expect(insertSession).toHaveBeenCalledTimes(1);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'ssh-root-1',
      player_key: attacker.publicKeyHex,
      machine_id: AP_GATEWAY_ID,
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'seed-session',
      source_ip: '192.168.1.5',
      kind: 'ssh',
      essid: ESSID,
    });
  });

  it('rejects a wrong password as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: 'definitely-not-the-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a non-root user as invalid_credentials (the gateway is a root-only appliance)', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    // The gateway has no guest/user account — only root. A correct workstation guest
    // password is meaningless here; `guest` is simply not an account on it.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports an unforwarded destination port as host_unreachable, before the password is checked and without asking who is on the AP', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, listOccupantsByEssid, insertSession } = makeDeps();

    // -p 2222 with the opt-in default (no forward configured): the gateway serves no
    // such port. A CORRECT admin password must NOT matter — routing decides first.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    // An unserved port is NOT a forward: the gate short-circuits at routing, without
    // reading any occupant's journal or even enumerating the AP.
    expect(findPatches).toHaveBeenCalledTimes(1);
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  describe('a forward lands on the occupant who leases the address it names', () => {
    it("routes a forwarded port to that occupant's box, validated against ITS passwd", async () => {
      const attacker = generateIdentity();
      const { deps, findPatches, insertSession } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, userType: 'guest', machine_id: ALICE_WS });
      // The journal is read off BOTH the gateway (forward table + boot gate) AND the
      // occupant's box (its running services + passwd) — the forward bridges the two.
      expect(findPatches).toHaveBeenCalledWith({ machine_id: AP_GATEWAY_ID });
      expect(findPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS });
      expect(insertSession.mock.calls[0]![0]).toMatchObject({
        machine_id: ALICE_WS,
        credentials: { username: 'guest', userType: 'guest' },
        kind: 'ssh',
        essid: ESSID,
      });
    });

    it('routes a forward published by an occupant who joined LATER than another — the AP has no single host behind its NAT', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: BOB_GUEST_PW, port: 3333 }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ machine_id: BOB_WS });
      expect(insertSession.mock.calls[0]![0]).toMatchObject({ machine_id: BOB_WS });
    });

    it('routes two forwards on ONE gateway to two different boxes, each with its own credentials', async () => {
      const attacker = generateIdentity();
      const patches = patchesByMachine({
        [AP_GATEWAY_ID]: [bothForwards],
        [ALICE_WS]: [sshdUp],
        [BOB_WS]: [sshdUp],
      });

      const onAlice = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        makeDeps({ patches }).deps,
      );
      const onBob = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: BOB_GUEST_PW, port: 3333 }),
        makeDeps({ patches }).deps,
      );

      expect(onAlice.body).toMatchObject({ machine_id: ALICE_WS });
      expect(onBob.body).toMatchObject({ machine_id: BOB_WS });
    });

    it("refuses one occupant's credentials on another occupant's forwarded port", async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [bothForwards],
          [ALICE_WS]: [sshdUp],
          [BOB_WS]: [sshdUp],
        }),
      });

      // Bob's guest password against the forward that lands on ALICE's box: the passwd
      // checked is the box the forward reaches, so this is simply a wrong password.
      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: BOB_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('reports a forward aimed at an address nobody on the AP leases as host_unreachable', async () => {
      const attacker = generateIdentity();
      const strayForward = forwards(forwardTo(2222, lanAddressFor(ESSID, 251)));
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [strayForward], [ALICE_WS]: [sshdUp] }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('reports a forward aimed at a lease whose holder has left the WiFi as host_unreachable — a lease outlives occupancy, reachability does not', async () => {
      const attacker = generateIdentity();
      const { deps } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
        listOccupantsByEssid: async () => ({ data: [aliceOccupant], error: null }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: BOB_GUEST_PW, port: 3333 }),
        deps,
      );

      expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    });

    it('reports a forward aimed at an occupant who holds no lease at all as host_unreachable', async () => {
      const attacker = generateIdentity();
      const { deps } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
        listLeasesByEssid: async () => ({
          data: [{ owner_key: ALICE.publicKeyHex, octet: ALICE_OCTET }],
          error: null,
        }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: BOB_GUEST_PW, port: 3333 }),
        deps,
      );

      expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    });

    it('reports a forwarded port as host_unreachable when that box never started sshd, before the password is checked', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [] }),
      });

      // A CORRECT guest password — liveness must win regardless, proving the routing
      // refuses a dark target before (and independent of) password validation.
      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it("reports a forwarded port as host_unreachable when the box serves a DIFFERENT port than the forward's internal target", async () => {
      const attacker = generateIdentity();
      // The forward targets `:22`, but sshd is bound to 2222 — the DNAT target port is
      // not listening even though the box has an open port. Liveness must check the
      // forward's specific internal port, not merely "any service is up".
      const sshdOnOtherPort: OwnerPatchRow = { ...sshdUp, content: 'sshd:port=2222' };
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [aliceForward],
          [ALICE_WS]: [sshdOnOtherPort],
        }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('refuses a forwarded port to a BRICKED box as host_unreachable, even with its sshd up and a correct password', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({
          [AP_GATEWAY_ID]: [aliceForward],
          [ALICE_WS]: [sshdUp, bootTombstone],
        }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it("reports a server error when the target box's journal lookup fails, without inserting", async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: async ({ machine_id }) =>
          machine_id === ALICE_WS
            ? { data: null, error: new Error('db down') }
            : { data: [aliceForward], error: null },
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('reports a server error when the occupant list lookup fails — never guesses who is behind a forward', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
        listOccupantsByEssid: async () => ({ data: null, error: new Error('db down') }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 500, body: { error: 'occupants_lookup_failed' } });
      expect(insertSession).not.toHaveBeenCalled();
    });

    it('reports a server error when the lease lookup fails — never guesses an address', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [aliceForward], [ALICE_WS]: [sshdUp] }),
        listLeasesByEssid: async () => ({ data: null, error: new Error('db down') }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: ALICE_GUEST_PW, port: 2222 }),
        deps,
      );

      expect(result).toEqual({ status: 500, body: { error: 'leases_lookup_failed' } });
      expect(insertSession).not.toHaveBeenCalled();
    });
  });

  it('refuses login to a bricked gateway (a /boot tombstone) as host_unreachable, before the password is checked and without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps({
      patches: async () => ({ data: [bootTombstone], error: null }),
    });

    // A CORRECT admin password — the brick must win regardless, proving the boot check
    // short-circuits before (and independent of) password validation.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: AP_GATEWAY_ID });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable for an unregistered public IP without inserting or reading the journal', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps({
      lookup: async () => ({ data: null, error: null }),
    });

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the network lookup fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps({ lookup: async () => ({ data: null, error: new Error('db down') }) });

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'network_lookup_failed' } });
  });

  it('reports a server error when the boot-state patch lookup fails, without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps({
      patches: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the session insert fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps({ insert: async () => ({ error: new Error('insert boom') }) });

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findNetworkByPublicIp, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW, player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();
    const signed = envelope(attacker, { username: 'root', password: ADMIN_PW });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleAuthCreateSessionPublic(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      signRequest(attacker, 'authCreateSessionPublic', {
        session_id: 'ssh-root-1',
        username: 'root',
        password: ADMIN_PW,
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });

  // A reachable cross-player ssh attempt leaves a truthful auth.log trace on the shared
  // record of the machine it reached. The keystone: the line is NOT written under the
  // attacker's key — the system owns its logs, so every attacker's line accretes into
  // ONE row instead of colliding under the last-write-wins fold; the attacker's identity
  // lives in the line content (source IP). A gateway-served port logs on the GATEWAY
  // record (its ESSID-seeded hostname); a forwarded port logs on the machine the forward
  // reached (its machine name). Every 404 host_unreachable logs nothing.
  describe('cross-player connection trace', () => {
    it("appends ONE auth.log 'Accepted' line on the GATEWAY record for a :22 login", async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps();

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0]).toEqual({
        writer_key: ALICE.publicKeyHex,
        machine_id: AP_GATEWAY_ID,
        path: AUTH_LOG_PATH,
        content: `${expectedSshdLine(seedApGatewayHostname(ESSID), 'success', 'root')}\n`,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
      });
      // The provenance is never the attacker — the keystone.
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(attacker.publicKeyHex);
    });

    it("accretes the gateway's log under ONE row whatever order the leases come back in", async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        listLeasesByEssid: async () => ({ data: [...BOTH_LEASES].reverse(), error: null }),
      });

      await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      // The gateway belongs to nobody, so its log has to accrete under SOME occupant's
      // row — and it must be the same one every time. A writer_key that moves splits the
      // log across rows, and the later row erases the earlier one on replay.
      expect(upsertPatch.mock.calls[0]![0].writer_key).toBe(ALICE.publicKeyHex);
    });

    it("logs a forwarded login on the record of the box it REACHED, under that occupant's key", async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        patches: patchesByMachine({ [AP_GATEWAY_ID]: [bobForward], [BOB_WS]: [sshdUp] }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'guest', password: BOB_GUEST_PW, port: 3333 }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
        writer_key: BOB.publicKeyHex,
        machine_id: BOB_WS,
        path: AUTH_LOG_PATH,
        content: `${expectedSshdLine(bobOccupant.workstation_machine_name, 'success', 'guest')}\n`,
      });
    });

    it('appends a "Failed password" line on a wrong password and still returns 401 without inserting', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch, insertSession } = makeDeps();

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: 'definitely-not-the-pw' }),
        deps,
      );

      expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
      expect(insertSession).not.toHaveBeenCalled();
      expect(upsertPatch.mock.calls[0]![0].content).toBe(
        `${expectedSshdLine(seedApGatewayHostname(ESSID), 'failure', 'root')}\n`,
      );
    });

    it("uses the attacker's OCCUPANT public IP as the source, ignoring the client source_ip", async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch, findHomeNetworkByOwnerKey } = makeDeps();

      await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW, source_ip: '10.0.0.66' }),
        deps,
      );

      // The lookup is keyed by the ATTACKER's verified key, not any occupant.
      expect(findHomeNetworkByOwnerKey).toHaveBeenCalledWith(attacker.publicKeyHex);
      const content = upsertPatch.mock.calls[0]![0].content;
      expect(content).toContain(`from ${ATTACKER_PUBLIC_IP}`);
      expect(content).not.toContain('10.0.0.66');
    });

    it("falls back to 'unknown' source when the attacker has no home network, still logging and authenticating", async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch.mock.calls[0]![0].content).toBe(
        `${expectedSshdLine(seedApGatewayHostname(ESSID), 'success', 'root', 'unknown')}\n`,
      );
    });

    it('authenticates but leaves no trace on an AP nobody has ever leased an address on', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        listLeasesByEssid: async () => ({ data: [], error: null }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes no auth.log line for an unregistered public IP (404, nothing to log on)', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({ lookup: async () => ({ data: null, error: null }) });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result.status).toBe(404);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes no auth.log line for a bricked gateway (whole public IP dark)', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        patches: async () => ({ data: [bootTombstone], error: null }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result.status).toBe(404);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes no auth.log line for an unforwarded destination port (404 before any log)', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps();

      // -p 2222 with the opt-in default (no forward): the gateway serves no such port.
      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW, port: 2222 }),
        deps,
      );

      expect(result.status).toBe(404);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('skips the write when the auth.log read fails (RMW bails), and still authenticates', async () => {
      const attacker = generateIdentity();
      const { deps, upsertPatch } = makeDeps({
        readAuthLog: async () => ({ data: null, error: new Error('log read down') }),
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns the auth result even when the log write throws (best-effort logging)', async () => {
      const attacker = generateIdentity();
      const { deps, insertSession } = makeDeps({
        upsertPatch: async () => {
          throw new Error('write blew up');
        },
      });

      const result = await handleAuthCreateSessionPublic(
        envelope(attacker, { username: 'root', password: ADMIN_PW }),
        deps,
      );

      expect(result).toEqual({
        status: 200,
        body: { ok: true, userType: 'root', machine_id: AP_GATEWAY_ID },
      });
      expect(insertSession).toHaveBeenCalledTimes(1);
    });
  });
});
