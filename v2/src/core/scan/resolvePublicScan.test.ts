import { describe, expect, it, vi } from 'vitest';
import {
  handleResolvePublicScan,
  type RegistryLookup,
  type ResolvePublicScanDeps,
} from './resolvePublicScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeApGatewayId } from '../identity/router';
import { assignHomeNetwork } from '../network/homeNetwork';
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
 * `nmap <public IP>` against ANOTHER identity's registered network. Story 5.1.1b
 * flips the resolved machine from the workstation to the ROUTER: a public IP maps
 * to the owner's router (its own seeded `sshd:22`), and the workstation is dark
 * behind NAT until a forward is configured (Story 5.1.3). The handler verifies the
 * caller's envelope, looks the target up in the registry, replays the ROUTER's
 * journal over its seeded base to ask `canBoot` (a bricked router goes dark), and
 * reports the router's open ports via the single `scanResult` total function.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
const ESSID = 'CoffeeShopWiFi';
// 2026-06-19 12:00:00 UTC — the server clock the kern.log trace is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
// B's (the scanner's) home public IP, as the registry returns it for B's owner key.
// Server-derived; NEVER the client-supplied `source_ip`.
const SCANNER_PUBLIC_IP = '198.51.100.22';
// A real identity so the router's seeded admin password / sshd presence recover
// from the owner key; the registry now also carries what materializing the
// workstation behind a NAT forward needs (machine id, essid, ws identity).
const OWNER = generateIdentity();
const REGISTERED: RegistryLookup = {
  router_machine_id: computeApGatewayId(ESSID),
  owner_key: OWNER.publicKeyHex,
  workstation_machine_id: 'workstation-a1b2c3d4',
  essid: ESSID,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
};

/** A's workstation LAN IP — the deterministic address a `rules.v4` forward must
 *  target to reach it (the server recomputes the same value from owner_key+essid). */
const wsLanIp = assignHomeNetwork(OWNER.publicKeyHex, ESSID).localIp;

/** A root `nano /etc/iptables/rules.v4` edit on the ROUTER's journal opening a NAT
 *  forward `2222 → <ws>:22` — the opt-in that exposes the workstation behind NAT. */
const routerForward: OwnerPatchRow = {
  path: '/etc/iptables/rules.v4',
  content: `forward 2222 to ${wsLanIp}:22`,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:01.000Z',
  writer_key: OWNER.publicKeyHex,
};

/** A's workstation `sshd` running — its pidfile planted on the WORKSTATION journal
 *  (A started the daemon). With it the forward is live; without it the ws is dark. */
const wsSshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

/** Route the journal read by machine id: the ROUTER's rows vs the WORKSTATION's
 *  rows — the handler reads each separately to scan ports + liveness-gate forwards. */
const patchesByMachine =
  (router: readonly OwnerPatchRow[], workstation: readonly OwnerPatchRow[]) =>
  async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> =>
    machine_id === REGISTERED.workstation_machine_id
      ? { data: workstation, error: null }
      : { data: router, error: null };

/** A root `rm /boot/vmlinuz` tombstone — replayed over a machine's seeded base, it
 *  deletes the kernel so `canBoot` reports that box bricked. Dropped on the ROUTER's
 *  journal it takes the whole public IP dark; dropped on the WORKSTATION's journal it
 *  drops only the forward behind the NAT (the router still answers its own ports). */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

type LookupResult = { data: RegistryLookup | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };
type OwnerKeyResult = { data: { public_ip: string } | null; error: unknown };

/** Overrides for the system-logging + source-IP deps (Story 6.1). Defaults: an
 *  empty log (a host-up scan appends one line), a successful write, and a
 *  registry that resolves the scanner's owner key to `SCANNER_PUBLIC_IP`. */
type LogOverrides = {
  readLog?: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  findRegistryByOwnerKey?: (ownerKey: string) => Promise<OwnerKeyResult>;
};

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: null, error: null }),
  patches: (query: { machine_id: string }) => Promise<PatchesResult> = async () => ({
    data: [],
    error: null,
  }),
  over: LogOverrides = {},
) => {
  const findRegistryByPublicIp = vi.fn<(publicIp: string) => Promise<LookupResult>>(lookup);
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(patches);
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const findRegistryByOwnerKey = vi.fn<(ownerKey: string) => Promise<OwnerKeyResult>>(
    over.findRegistryByOwnerKey ??
      (async () => ({ data: { public_ip: SCANNER_PUBLIC_IP }, error: null })),
  );
  const deps: ResolvePublicScanDeps = {
    nonceStore: freshStore,
    findRegistryByPublicIp,
    findPatches,
    now: () => FIXED_NOW,
    readLog,
    upsertPatch,
    findRegistryByOwnerKey,
  };
  return {
    deps,
    findRegistryByPublicIp,
    findPatches,
    readLog,
    upsertPatch,
    findRegistryByOwnerKey,
  };
};

/** The kern.log line the server is expected to stamp on the ROUTER record for a
 *  host-up cross-player scan at `FIXED_NOW`: the router's owner-seeded hostname,
 *  B's server-derived source IP, and the ports B actually saw. */
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

describe('handleResolvePublicScan', () => {
  it("resolves a registered public IP to the ROUTER's own sshd:22 (workstation dark behind NAT)", async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp, findPatches } = makeDeps(async () => ({
      data: REGISTERED,
      error: null,
    }));

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // Exactly the router's own port — nothing from behind the NAT.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
    expect(findRegistryByPublicIp).toHaveBeenCalledWith(TARGET);
    // The journal is read off the ROUTER machine, not the workstation.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: REGISTERED.router_machine_id });
  });

  it('surfaces a forwarded port on the public IP when the workstation behind it is up', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      patchesByMachine([routerForward], [wsSshdUp]),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // The router's own :22 PLUS the live forward, mapped to its public port :2222.
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        found: true,
        ports: [
          { port: 22, service: 'ssh' },
          { port: 2222, service: 'ssh' },
        ],
      },
    });
    // The forward's liveness is gated on the WORKSTATION journal, read separately.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: REGISTERED.workstation_machine_id });
  });

  it('hides a forwarded port when the workstation behind it is down', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      // Forward configured, but the workstation sshd is NOT running (empty journal).
      patchesByMachine([routerForward], []),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // Only the router's own port — the dead forward is not advertised.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('hides a forwarded port when the workstation behind it is bricked, even though its sshd pidfile lingers (router still answers its own port)', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      // Forward configured + ws sshd pidfile present, but the workstation is bricked.
      patchesByMachine([routerForward], [wsSshdUp, bootTombstone]),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // Only the router's own port — a bricked box behind the NAT can't answer, so its
    // forward drops; the router itself still boots and serves :22.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('does not read the workstation journal when no forward is configured', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps(async () => ({ data: REGISTERED, error: null }));

    await handleResolvePublicScan(envelope(id, TARGET), deps);

    // A fresh box exposes only the router; the workstation behind NAT is never touched.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: REGISTERED.router_machine_id });
    expect(findPatches).not.toHaveBeenCalledWith({
      machine_id: REGISTERED.workstation_machine_id,
    });
    expect(findPatches).toHaveBeenCalledTimes(1);
  });

  it('reports a server error when the workstation journal lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async ({ machine_id }) =>
        machine_id === REGISTERED.workstation_machine_id
          ? { data: null, error: new Error('ws db down') }
          : { data: [routerForward], error: null },
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports a bricked router (a /boot tombstone on its journal) as host down, with no ports', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: [bootTombstone], error: null }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // Host-down shape — indistinguishable from an unregistered IP (the client maps
    // `found: false` to "Host seems down").
    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: REGISTERED.router_machine_id });
  });

  it('reports a server error when the boot-state patch lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: null, error: new Error('db down') }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('reports an unregistered public IP as not found, with no ports', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps(async () => ({ data: null, error: null }));

    const result = await handleResolvePublicScan(envelope(id, '203.0.113.99'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    // No registry row → no router to check; the journal read is skipped.
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });

  it('rejects a tampered envelope without looking up the registry', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();
    const signed = envelope(id, TARGET);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolvePublicScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(
      envelope(id, TARGET, { player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(signRequest(id, 'resolvePublicScan', {}), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  // Story 6.1: a host-up cross-player scan leaves a truthful kern.log trace on the
  // TARGET's shared router record. The keystone (decision 1): the line is written
  // under the TARGET OWNER's writer_key (the system owns its logs) so multi-writer
  // rows don't collapse under the last-write-wins fold — the scanner's identity
  // lives in the line content (source IP), never in writer_key.
  describe('cross-player scan trace (Story 6.1)', () => {
    it("appends ONE kern.log line on the ROUTER record under the OWNER's writer_key for a host-up scan", async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps(async () => ({ data: REGISTERED, error: null }));

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      // The scan result is unchanged by the logging.
      expect(result).toEqual({
        status: 200,
        body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
      });
      expect(upsertPatch).toHaveBeenCalledTimes(1);
      expect(upsertPatch.mock.calls[0]![0]).toEqual({
        writer_key: REGISTERED.owner_key,
        machine_id: REGISTERED.router_machine_id,
        path: '/var/log/kern.log',
        content: `${expectedKernLine(SCANNER_PUBLIC_IP, [22])}\n`,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
        node_type: 'file',
      });
      // The provenance is the OWNER, never the scanner — the keystone.
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(scanner.publicKeyHex);
    });

    it('lists every port B actually saw, including a live NAT forward', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps(
        async () => ({ data: REGISTERED, error: null }),
        patchesByMachine([routerForward], [wsSshdUp]),
      );

      await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      // Router's own :22 plus the forwarded :2222 — the same port set the scan returned.
      expect(upsertPatch.mock.calls[0]![0].content).toBe(
        `${expectedKernLine(SCANNER_PUBLIC_IP, [22, 2222])}\n`,
      );
    });

    it("uses B's REGISTRY public IP as the source, ignoring a client-supplied source_ip", async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch, findRegistryByOwnerKey } = makeDeps(async () => ({
        data: REGISTERED,
        error: null,
      }));

      await handleResolvePublicScan(envelope(scanner, TARGET, { source_ip: '10.0.0.66' }), deps);

      // The lookup is keyed by the SCANNER's verified key, not the target owner.
      expect(findRegistryByOwnerKey).toHaveBeenCalledWith(scanner.publicKeyHex);
      const content = upsertPatch.mock.calls[0]![0].content;
      expect(content).toContain(`from ${SCANNER_PUBLIC_IP}`);
      expect(content).not.toContain('10.0.0.66');
    });

    it("falls back to 'unknown' source when B has no registry row, still logging and succeeding", async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps(
        async () => ({ data: REGISTERED, error: null }),
        undefined,
        {
          findRegistryByOwnerKey: async () => ({ data: null, error: null }),
        },
      );

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body.found).toBe(true);
      expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedKernLine('unknown', [22])}\n`);
    });

    it('writes nothing for an unregistered public IP (found:false)', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps(async () => ({ data: null, error: null }));

      const result = await handleResolvePublicScan(envelope(scanner, '203.0.113.99'), deps);

      expect(result.body.found).toBe(false);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes nothing for a bricked router (found:false)', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps(
        async () => ({ data: REGISTERED, error: null }),
        async () => ({ data: [bootTombstone], error: null }),
      );

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result.body.found).toBe(false);
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('skips the write when the log read fails (RMW bails), and still returns the scan', async () => {
      const scanner = generateIdentity();
      const { deps, upsertPatch } = makeDeps(
        async () => ({ data: REGISTERED, error: null }),
        undefined,
        {
          readLog: async () => ({ data: null, error: new Error('log read down') }),
        },
      );

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result).toEqual({
        status: 200,
        body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
      });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns the scan even when the log write throws (best-effort logging)', async () => {
      const scanner = generateIdentity();
      const { deps } = makeDeps(async () => ({ data: REGISTERED, error: null }), undefined, {
        upsertPatch: async () => {
          throw new Error('write blew up');
        },
      });

      const result = await handleResolvePublicScan(envelope(scanner, TARGET), deps);

      expect(result).toEqual({
        status: 200,
        body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
      });
    });
  });
});
