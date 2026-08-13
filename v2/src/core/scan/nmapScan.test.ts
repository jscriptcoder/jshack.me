import { describe, expect, it, vi } from 'vitest';
import { handleNmapScan, type NmapScanDeps } from './nmapScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { buildApGatewayBaseFs, seedApGatewayHostname } from '../generation/routerFs';
import { hostMachineId } from '../generation/remoteHostId';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { computeInnerGatewayId, computeApGatewayId } from '../identity/router';
import { assignHomeNetwork } from '../network/homeNetwork';
import { materializeWorkstationFs, type OwnerPatchRow } from '../network/materializeWorkstationFs';
import { readOpenPorts } from '../services/pidfile';
import { md5 } from '../generation/md5';
import { formatNmapScanAggregate, KERN_LOG_OWNER, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { asGameTime, asPlayerKeyHex } from '../types';
import type { ScanOccupant } from './nmapScan';
import type { LanLeaseRow } from '../network/lanAddress';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleNmapScan` is the server-side scan action: it verifies the signed
 * envelope, REGENERATES the caller's own LAN from the verified pubkey + essid,
 * and — server-internal — appends ONE aggregate `/var/log/kern.log` line to EACH
 * scanned host (the SSH-epic `appendMachineLog` pattern). Per-host, never per
 * probe; every up host except the player's own workstation (which is keyed by a
 * different machine_id); the line lists that host's own open ports. The line lands
 * on the host's shared journal keyed by the caller's writer_key + machine_id; the
 * cross-player trace READ (a different identity reading it) is a later story.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// 2026-06-07 14:32:01 UTC — the server clock the kern.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 7, 14, 32, 1);
const SOURCE_IP = '192.168.1.50';

type OccupantsResult = { data: readonly ScanOccupant[] | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };
type LeasesResult = { data: readonly LanLeaseRow[] | null; error: unknown };

const makeDeps = (over: Partial<NmapScanDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({
      data: null,
      error: null,
    }),
  );
  // Default: no fellow occupants and an empty journal — the own-LAN NPC scan is
  // unaffected (every existing test keeps passing); occupant tests override these.
  const listOccupantsByEssid = vi.fn<(essid: string) => Promise<OccupantsResult>>(async () => ({
    data: [],
    error: null,
  }));
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
    async () => ({ data: [], error: null }),
  );
  // Default: no leases either, matching the empty occupancy above. Occupant tests
  // supply leases for exactly the occupants they list.
  const listLeasesByEssid = vi.fn<(essid: string) => Promise<LeasesResult>>(async () => ({
    data: [],
    error: null,
  }));
  const deps: NmapScanDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    readLog,
    upsertPatch,
    listOccupantsByEssid,
    listLeasesByEssid,
    findPatches,
    ...over,
  };
  return { deps, upsertPatch, readLog, listOccupantsByEssid, listLeasesByEssid, findPatches };
};

const subnetOf = (): string => generateHomeLan(ESSID).subnet;
const selfIpOf = (pubkey: string): string => assignHomeNetwork(pubkey, ESSID).localIp;
const octetOf = (ip: string): number => Number(ip.split('.')[3]);

/** An identity whose own LAN address is NOT one a generated host already holds.
 *
 *  The player's octet is drawn from their (random) pubkey while the NPC octets are
 *  drawn from the ESSID, so roughly one identity in twenty-five lands on top of a
 *  generated host. That collision puts a REAL host at the "self" address, which is a
 *  different scenario from the one a self-exclusion test means to describe — so draw
 *  again rather than let the coincidence read as a failure. */
const identityOffTheGeneratedLan = (): ReturnType<typeof generateIdentity> => {
  const taken = new Set(generateHomeLan(ESSID).hosts.map((host) => host.ip));
  const candidate = generateIdentity();
  return taken.has(selfIpOf(candidate.publicKeyHex))
    ? identityOffTheGeneratedLan()
    : candidate;
};

/** An identity whose own derived octet is none of `avoid`.
 *
 *  A test that leases occupants onto FIXED octets is describing "the lease moved
 *  away from what the derivation offered". An identity whose derivation happens to
 *  land on one of those same octets describes the opposite, and reads as a failure
 *  rather than as the coincidence it is. No constant is safe by construction:
 *  derived octets are uniform across the whole 2-254 range, so any chosen pair is
 *  hit by roughly one draw in 250. */
const identityOffOctets = (avoid: readonly number[]): ReturnType<typeof generateIdentity> => {
  const candidate = generateIdentity();
  return avoid.includes(octetOf(selfIpOf(candidate.publicKeyHex)))
    ? identityOffOctets(avoid)
    : candidate;
};

/** Every host the server should log on for a full-range scan: all up hosts
 *  except the player's own workstation, in ascending-octet (lan) order. */
const loggedHostsOf = (pubkey: string): readonly LanHost[] => {
  const selfIp = selfIpOf(pubkey);
  return generateHomeLan(ESSID).hosts.filter((host) => host.ip !== selfIp);
};

/** The first generic NPC sibling (a `kind:'machine'` host that is not the player's
 *  own workstation) — the coordinate-keyed path, distinct from the `.1` router. */
const firstSiblingOf = (pubkey: string): LanHost =>
  loggedHostsOf(pubkey).find((host) => host.kind === 'machine')!;

/** The `.1` edge gateway host (the first `kind:'router'` host in octet order). */
const gatewayOf = (): LanHost =>
  generateHomeLan(ESSID).hosts.find((host) => host.kind === 'router')!;

/** The inner gateway — a SECOND router on the LAN, at a non-.1 octet. */
const innerGatewayOf = (): LanHost =>
  generateHomeLan(ESSID).hosts.find(
    (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
  )!;

// The ports the server logs for a host, mirroring production's FS choice via the
// shared resolver: the edge router and inner gateway read their real router base
// FS; every NPC sibling reads its generic coordinate FS.
const portsOf = ( host: LanHost): readonly number[] =>
  readOpenPorts(resolveLanHostIdentity(host, ESSID).baseFs).map((port) => port.port);

/** The kern.log line the server should stamp for a scan of `host` at FIXED_NOW. */
const expectedKernLine = (host: LanHost): string =>
  formatNmapScanAggregate({
    time: asGameTime(FIXED_NOW),
    hostname: host.hostname,
    sourceIp: SOURCE_IP,
    probedPorts: portsOf(host),
  });

// A FIXED identity whose deterministic LAN gateway runs a service, so a test can
// pin that the host's REAL port reaches the log line. The `.1` router always runs
// ssh (port 22). The /24 is now ESSID-seeded (Story 7.1), so every identity on
// 'BEAN-THERE-WIFI' sits on 192.168.29 and its gateway is 192.168.29.1.
const PORTED_IDENTITY: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('7af20db688cbc12e66e5a499e232818a6a63011a641493c6cbc821a377cbbb32'),
  privateKeyHex: '88fd07c8eea8d81329435d6eefacf423aae078245e5a9b71940e1653573d7cf7',
};
// The `.1` router carries its owner-seeded name (Story 6.0), exactly as the
// regenerated LAN does — so the logged kern.log line names the real router.
const PORTED_HOST: LanHost = {
  ip: '192.168.29.1',
  hostname: seedApGatewayHostname(ESSID),
  kind: 'router',
};
const PORTED_SUBNET = '192.168.29';

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  target: string,
  over: Record<string, unknown> = {},
) => signRequest(id, 'nmapScan', { essid: ESSID, target, source_ip: SOURCE_IP, ...over });

describe('handleNmapScan', () => {
  it('appends one kern.log line to every up host in a full-range scan, skipping the own host', async () => {
    // Draws off the generated LAN like its siblings: an identity whose own address
    // collides with a generated host makes `loggedHostsOf` drop a host the server
    // never dropped, and the count assertion below fails on the coincidence rather
    // than on the behaviour it describes.
    const id = identityOffTheGeneratedLan();
    const { deps, upsertPatch } = makeDeps();
    const logged = loggedHostsOf(id.publicKeyHex);

    const result = await handleNmapScan(envelope(id, `${subnetOf()}.1-254`), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: logged.length } });
    expect(upsertPatch).toHaveBeenCalledTimes(logged.length);
    logged.forEach((host, index) => {
      // Each host logs on the id the shared resolver picks: the edge router, an
      // inner gateway, or a generic NPC sibling's coordinate id.
      const expectedMachineId = resolveLanHostIdentity(host, ESSID).machineId;
      expect(upsertPatch.mock.calls[index]![0]).toEqual({
        writer_key: id.publicKeyHex,
        machine_id: expectedMachineId,
        path: '/var/log/kern.log',
        content: `${expectedKernLine(host)}\n`,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
        node_type: 'file',
      });
    });
  });

  it('records the same LAN for every occupant of an ESSID — same hosts, same ids, same names', async () => {
    // The LAN belongs to the access point, not to whoever is looking at it. Two
    // occupants sweeping the same /24 must therefore touch the same boxes: the same
    // machine ids (so a write by one is a write the other can read) under the same
    // hostnames. The scanner's key stays an input here — it is the verified signer —
    // so this stays a real claim about two viewers rather than a tautology.
    const sweep = async (id: ReturnType<typeof generateIdentity>) => {
      const { deps, upsertPatch } = makeDeps();
      await handleNmapScan(envelope(id, `${subnetOf()}.1-254`), deps);
      return upsertPatch.mock.calls.map(([row]) => ({
        machine_id: row.machine_id,
        content: row.content,
      }));
    };

    expect(await sweep(generateIdentity())).toEqual(await sweep(generateIdentity()));
  });

  it('logs exactly one line when scanning a single real host', async () => {
    const id = generateIdentity();
    const host = firstSiblingOf(id.publicKeyHex);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, host.ip), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 1 });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(hostMachineId(host, ESSID));
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `${expectedKernLine(host)}\n`,
    );
  });

  it('appends after the existing log content rather than clobbering it', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps({
      readLog: vi.fn(async () => ({ data: { content: 'PRIOR LINE\n' }, error: null })),
    });

    await handleNmapScan(envelope(id, host.ip), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `PRIOR LINE\n${expectedKernLine(host)}\n`,
    );
  });

  it('writes nothing when the single target octet has no host (host down)', async () => {
    const id = generateIdentity();
    const subnet = subnetOf();
    const taken = new Set(generateHomeLan(ESSID).hosts.map((host) => host.ip));
    const freeOctet = Array.from({ length: 253 }, (_, index) => index + 2).find(
      (octet) => !taken.has(`${subnet}.${octet}`),
    )!;
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, `${subnet}.${freeOctet}`), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('skips the player own workstation (it is keyed by a different machine_id)', async () => {
    const id = identityOffTheGeneratedLan();
    const selfIp = selfIpOf(id.publicKeyHex);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, selfIp), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('writes nothing for a target on a foreign subnet', async () => {
    const id = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, '10.0.0.1-254'), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without writing', async () => {
    const id = generateIdentity();
    const { deps, upsertPatch } = makeDeps();
    const signed = envelope(id, `${subnetOf()}.1-254`);
    // Mutate the signed payload so the signature no longer matches it: the
    // structure stays valid (so it reaches the signature check) but verification
    // fails → 401, and nothing is written.
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleNmapScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const id = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(
      envelope(id, `${subnetOf()}.1-254`, { player_key: 'attacker-key' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target field', async () => {
    const id = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(
      signRequest(id, 'nmapScan', { essid: ESSID, source_ip: SOURCE_IP }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('lists the scanned host real open ports in the logged line', async () => {
    const ports = portsOf( PORTED_HOST);
    // Guards the fixture's premise: if generation ever stops giving this host a
    // service, this fails loudly instead of silently testing a 0-port line.
    expect(ports).toContainEqual(22);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(PORTED_IDENTITY, PORTED_HOST.ip), deps);

    const content = upsertPatch.mock.calls[0]![0].content;
    expect(content).toBe(`${expectedKernLine(PORTED_HOST)}\n`);
    // The actual port numbers must reach the line (not, say, `undefined`).
    for (const port of ports) expect(content).toContain(String(port));
  });

  // A target must match the IP/range syntax EXACTLY (anchored) — garbage before or
  // after the address is rejected, never parsed by finding an address mid-string.
  it.each([
    ['leading garbage on a range', `x${PORTED_SUBNET}.1-254`],
    ['trailing garbage on a range', `${PORTED_SUBNET}.1-254x`],
    ['leading garbage on a single IP', `x${PORTED_SUBNET}.1`],
    ['trailing garbage on a single IP', `${PORTED_SUBNET}.1x`],
  ])('writes nothing for %s', async (_label, target) => {
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(PORTED_IDENTITY, target), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records the source ip as "unknown" when the envelope omits it', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(
      signRequest(id, 'nmapScan', { essid: ESSID, target: host.ip }),
      deps,
    );

    expect(result.body).toEqual({ ok: true, hostsLogged: 1 });
    expect(upsertPatch.mock.calls[0]![0].content).toContain('Port scan from unknown —');
  });
});

/**
 * Story 6.4 — own-LAN `.1` scan writes the REAL router record. The `.1` gateway is
 * reached at run time via `ssh root@.1` → `computeApGatewayId(ESSID)`; its coordinate
 * `hostMachineId('<router name>', essid)` is a DEAD-END record nobody reads. So the
 * scan line for the gateway host must land on `computeApGatewayId(ESSID)`, while a
 * generic NPC sibling keeps its coordinate `hostMachineId`.
 */
// A FIXED identity (found once via a dev-time search, then hardcoded) whose `.1`
// router's OWN services (`buildApGatewayBaseFs` → always `sshd:22`) DIFFER from its
// generic coordinate FS (`buildRemoteHostFs` → no open ports here) — so a test can
// prove the logged line lists the ROUTER's real ports, not the dead generic ones.
const ROUTER_PORTS_IDENTITY: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('d1f9513763e20bc7d3c6579b2f9159972c2d79e0232c16358573e67d80f0d1d1'),
  privateKeyHex: 'b06229c561e83d6513a217c0e80760adc729cf73f2a787c554af70464b10ec14',
};

describe('handleNmapScan — own-LAN .1 scan → real router record', () => {
  it('logs the .1 gateway scan on computeApGatewayId(ESSID), not the dead-end hostMachineId', async () => {
    const id = generateIdentity();
    const gateway = gatewayOf();
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, gateway.ip), deps);

    const routerId = computeApGatewayId(ESSID);
    // The two ids genuinely differ — the assertion below is only meaningful because
    // the line moved OFF the dead-end coordinate record ONTO the one `ssh root@.1`
    // resolves to.
    expect(routerId).not.toBe(hostMachineId(gateway, ESSID));
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(routerId);
  });

  it('still logs a generic NPC sibling on its coordinate hostMachineId', async () => {
    const id = generateIdentity();
    const sibling = firstSiblingOf(id.publicKeyHex);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, sibling.ip), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(hostMachineId(sibling, ESSID));
  });

  it('logs the inner gateway scan on computeInnerGatewayId(caller), distinct from the edge router id', async () => {
    const id = generateIdentity();
    const inner = innerGatewayOf();
    const octet = Number(inner.ip.split('.')[3]);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, inner.ip), deps);

    const innerId = computeInnerGatewayId(ESSID, octet);
    // The trace lands on the inner gateway's OWN id — never the edge router's
    // (would alias) nor its dead-end coordinate record — listing its own sshd:22.
    expect(innerId).not.toBe(computeApGatewayId(ESSID));
    expect(innerId).not.toBe(hostMachineId(inner, ESSID));
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(innerId);
    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedKernLine(inner)}\n`);
  });

  it('logs the router scan with the router real ports (sshd:22), not the dead generic host FS', async () => {
    const id = ROUTER_PORTS_IDENTITY;
    const gateway = gatewayOf();
    const realPorts = readOpenPorts(buildApGatewayBaseFs(ESSID)).map((port) => port.port);
    const genericPorts = readOpenPorts(buildRemoteHostFs(ESSID, gateway)).map(
      (port) => port.port,
    );
    // Fixture premise: the router's own services (always sshd:22) genuinely DIFFER
    // from the generic coordinate FS — so the content assertion distinguishes the
    // two sources rather than passing by coincidence.
    expect(realPorts).toContain(22);
    expect(realPorts).not.toEqual(genericPorts);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, gateway.ip), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedKernLine(gateway)}\n`);
  });

  it('does not log the player own workstation on the router record (self still skipped)', async () => {
    // Draws off the generated LAN for the same reason as the sibling test above:
    // an identity whose octet lands on a real host makes "scan yourself" a
    // different scenario entirely, and the coincidence reads as a failure of
    // self-exclusion rather than as the collision it is.
    const id = identityOffTheGeneratedLan();
    const selfIp = selfIpOf(id.publicKeyHex);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, selfIp), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

/**
 * Story 7 — a same-WiFi scan also leaves a trace on a REAL fellow occupant's box. The
 * own-LAN NPC tracing above regenerates the caller's OWN siblings; this path reads the
 * ESSID occupancy and, for a target matching a fellow occupant's LAN IP, writes a
 * kern.log line on that occupant's REAL workstation — owner-keyed (writer = the target
 * owner) so multiple scanners accrete into one row, with the caller's SERVER-DERIVED LAN
 * IP as the source (never the client `source_ip`), listing the occupant's real open
 * ports (materialized from its own journal, never fabricated from the caller's seed). A
 * non-occupant caller, the caller's own row, and a bricked (dark) occupant log nothing.
 */
const A_ROOT_HASH = md5('toor');

const occupantRow = (
  owner: ReturnType<typeof generateIdentity>,
  machineId: string,
  machineName: string,
): ScanOccupant => ({
  owner_key: owner.publicKeyHex,
  workstation_machine_id: machineId,
  workstation_machine_name: machineName,
  workstation_username: 'neo',
  workstation_root_hash: A_ROOT_HASH,
});

/** A started workstation's sshd pidfile — makes :22 a live service on the
 *  materialized box (a fresh ws has an empty /var/run). */
const wsSshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-19T00:00:00.000Z',
  writer_key: 'unused-here',
};

/** A root `rm /boot/vmlinuz` tombstone — replayed over the seeded base it bricks the
 *  box so `canBoot` reports it dark. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-19T00:00:00.000Z',
  writer_key: 'unused-here',
};

/** The kern.log line the server should stamp on occupant A's box for a scan by B. */
const expectedOccupantLine = (
  occ: ScanOccupant,
  patches: readonly OwnerPatchRow[],
  sourceIp: string,
): string =>
  formatNmapScanAggregate({
    time: asGameTime(FIXED_NOW),
    hostname: occ.workstation_machine_name,
    sourceIp,
    probedPorts: readOpenPorts(materializeWorkstationFs(occ, patches)).map((port) => port.port),
  });

/** Find the upsert call that wrote a trace on the given machine_id (occupant traces
 *  may sit alongside the caller's own NPC traces, so we locate by target, not order). */
const traceOn = (
  upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'],
  machineId: string,
): PatchRow | undefined =>
  upsertPatch.mock.calls.map((call) => call[0]).find((row) => row.machine_id === machineId);

describe('handleNmapScan — same-LAN scan traces a fellow occupant', () => {
  const setup = (
    over: {
      aPatches?: readonly OwnerPatchRow[];
      caller?: 'bob' | 'stranger';
      listOccupantsByEssid?: NmapScanDeps['listOccupantsByEssid'];
      listLeasesByEssid?: NmapScanDeps['listLeasesByEssid'];
      findPatches?: NmapScanDeps['findPatches'];
      /** Octets to lease instead of the ones the derivation offered — the state after
       *  the allocator redrew past an octet another occupant already held. */
      redrawn?: { readonly alice: number; readonly bob: number };
      /** Drop the caller's OCCUPANCY row while leaving its lease intact — a player who
       *  disconnected. The lease is permanent; occupancy is not. */
      callerOffLan?: boolean;
      /** Report an error on the occupancy read while still handing back rows — a
       *  failed read must not be trusted just because it returned something. */
      occupancyReadFails?: boolean;
      /** Exactly which leases the ESSID holds, given the generated identities. */
      leases?: (ids: {
        readonly alice: ReturnType<typeof generateIdentity>;
        readonly bob: ReturnType<typeof generateIdentity>;
      }) => readonly LanLeaseRow[];
      /** Report an error on the lease read while still handing back rows. */
      leaseReadFails?: boolean;
    } = {},
  ) => {
    // Redrawn leases sit on fixed octets, and a derivation that lands on one of them
    // would put the occupant back where the test says it is NOT.
    const avoidOctets = over.redrawn === undefined ? [] : [over.redrawn.alice, over.redrawn.bob];
    const alice = identityOffOctets(avoidOctets);
    const bob = identityOffOctets(avoidOctets);
    const stranger = generateIdentity();
    const aWs = `workstation-${alice.publicKeyHex.slice(0, 8)}`;
    const bWs = `workstation-${bob.publicKeyHex.slice(0, 8)}`;
    const occAlice = occupantRow(alice, aWs, 'skylab');
    const occBob = occupantRow(bob, bWs, 'nebuchadnezzar');
    const aPatches = over.aPatches ?? [wsSshdUp];
    // Leases as the allocator seeds them — each occupant on the octet the derivation
    // offered — unless the test asks for a redraw.
    const leasedOctets = over.redrawn ?? {
      alice: octetOf(selfIpOf(alice.publicKeyHex)),
      bob: octetOf(selfIpOf(bob.publicKeyHex)),
    };
    // The lease reader deps actually get — returned below so a test can retarget it.
    const listLeasesByEssid =
      over.listLeasesByEssid ??
      vi.fn(async () => ({
        data: over.leases?.({ alice, bob }) ?? [
          { owner_key: alice.publicKeyHex, octet: leasedOctets.alice },
          { owner_key: bob.publicKeyHex, octet: leasedOctets.bob },
        ],
        error: over.leaseReadFails === true ? new Error('db down') : null,
      }));
    const { deps, upsertPatch } = makeDeps({
      listOccupantsByEssid:
        over.listOccupantsByEssid ??
        vi.fn(async () => ({
          data: over.callerOffLan === true ? [occAlice] : [occAlice, occBob],
          error: over.occupancyReadFails === true ? new Error('db down') : null,
        })),
      listLeasesByEssid,
      findPatches:
        over.findPatches ??
        vi.fn(async ({ machine_id }) => ({
          data: machine_id === aWs ? aPatches : [],
          error: null,
        })),
    });
    const caller = over.caller === 'stranger' ? stranger : bob;
    const subnet = subnetOf();
    return {
      deps,
      upsertPatch,
      listLeasesByEssid,
      alice,
      bob,
      caller,
      aWs,
      bWs,
      occAlice,
      occBob,
      aPatches,
      aLan: `${subnet}.${leasedOctets.alice}`,
      bLan: `${subnet}.${leasedOctets.bob}`,
    };
  };

  it("writes a kern.log line on the occupant's real box, under the owner's key, from the caller's LAN IP", async () => {
    const ctx = setup();

    await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toEqual({
      writer_key: ctx.alice.publicKeyHex,
      machine_id: ctx.aWs,
      path: '/var/log/kern.log',
      content: `${expectedOccupantLine(ctx.occAlice, ctx.aPatches, ctx.bLan)}\n`,
      owner: KERN_LOG_OWNER,
      permissions: KERN_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it("lists the occupant's real open ports (sshd:22), materialized from its own journal", async () => {
    const ctx = setup();

    await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    const content = traceOn(ctx.upsertPatch, ctx.aWs)!.content as string;
    expect(content).toContain('probed ports 22');
  });

  it('traces an occupant whose LAN IP falls inside a scanned range', async () => {
    const ctx = setup();
    const subnet = subnetOf();

    await handleNmapScan(envelope(ctx.bob, `${subnet}.1-254`), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)?.content).toContain(`Port scan from ${ctx.bLan}`);
  });

  it("uses the caller's SERVER-DERIVED LAN IP, never the client-supplied source_ip", async () => {
    const ctx = setup();

    await handleNmapScan(envelope(ctx.bob, ctx.aLan, { source_ip: '203.0.113.222' }), ctx.deps);

    const content = traceOn(ctx.upsertPatch, ctx.aWs)!.content as string;
    expect(content).toContain(ctx.bLan);
    expect(content).not.toContain('203.0.113.222');
  });

  it('does not trace a fellow occupant when the caller is not a live occupant of the ESSID', async () => {
    const ctx = setup({ caller: 'stranger' });

    await handleNmapScan(envelope(ctx.caller, ctx.aLan), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it("excludes the caller's own occupancy row (self is the own-LAN path, not an occupant trace)", async () => {
    const ctx = setup();

    await handleNmapScan(envelope(ctx.bob, ctx.bLan), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.bWs)).toBeUndefined();
  });

  it('does not trace a bricked (dark) occupant, even with sshd up', async () => {
    const ctx = setup({ aPatches: [wsSshdUp, bootTombstone] });

    await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('does not trace an occupant whose LAN IP the single target does not cover', async () => {
    const ctx = setup();
    const aOctet = Number(ctx.aLan.split('.')[3]);
    const otherOctet = aOctet === 100 ? 101 : 100;

    await handleNmapScan(
      envelope(ctx.bob, `${subnetOf()}.${otherOctet}`),
      ctx.deps,
    );

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('traces nobody — and does not throw — when the scan target is on a foreign subnet', async () => {
    const ctx = setup();

    const result = await handleNmapScan(envelope(ctx.bob, '10.0.0.5'), ctx.deps);

    expect(result.status).toBe(200);
    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('skips occupant tracing without failing the scan when the occupancy lookup errors', async () => {
    // Rows AND an error: a failed read is not trusted even when it hands back data.
    const ctx = setup({ occupancyReadFails: true });

    const result = await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(result.status).toBe(200);
    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('skips an occupant whose journal lookup errors, without failing the scan', async () => {
    const ctx = setup({ findPatches: vi.fn(async () => ({ data: null, error: new Error('db down') })) });

    const result = await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(result.status).toBe(200);
    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  /** Alice and Bob both on REDRAWN octets — the state after the allocator found the
   *  octets their derivations offered already taken. `setup` draws identities whose
   *  derivations avoid these two, so a scan that reaches `.7`/`.8` can only have
   *  resolved the lease. */
  const REDRAWN = { alice: 7, bob: 8 };

  it("traces an occupant at the octet it LEASED, not the one its derivation offered", async () => {
    const ctx = setup({ redrawn: REDRAWN });

    await handleNmapScan(envelope(ctx.bob, `${subnetOf()}.7`), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeDefined();
  });

  it("does not trace an occupant at its DERIVED octet once its lease moved elsewhere", async () => {
    const ctx = setup({ redrawn: REDRAWN });
    const derivedAliceIp = selfIpOf(ctx.alice.publicKeyHex);

    await handleNmapScan(envelope(ctx.bob, derivedAliceIp), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it("stamps the caller's LEASED address as the trace source, not its derived one", async () => {
    const ctx = setup({ redrawn: REDRAWN });

    await handleNmapScan(envelope(ctx.bob, `${subnetOf()}.7`), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)?.content).toBe(
      `${expectedOccupantLine(ctx.occAlice, ctx.aPatches, `${subnetOf()}.8`)}\n`,
    );
  });

  it('does not trace an occupant that holds no lease, even when the scanner holds one', async () => {
    // Only the scanner is leased: the target occupies the LAN but holds no address.
    const ctx = setup({
      redrawn: REDRAWN,
      leases: ({ bob }) => [{ owner_key: bob.publicKeyHex, octet: REDRAWN.bob }],
    });

    await handleNmapScan(envelope(ctx.bob, `${subnetOf()}.1-254`), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('traces nobody when the SCANNER holds no lease — there is no source address to stamp', async () => {
    // Only the target is leased: the scanner is a live occupant with no address of its
    // own, so a trace could only be written from an invented source.
    const ctx = setup({
      redrawn: REDRAWN,
      leases: ({ alice }) => [{ owner_key: alice.publicKeyHex, octet: REDRAWN.alice }],
    });

    await handleNmapScan(envelope(ctx.bob, `${subnetOf()}.1-254`), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('traces nobody when the scanner left the LAN, even though its lease survives the disconnect', async () => {
    // A lease outlives occupancy, so a disconnected player still holds an address. Being
    // ADDRESSED is not being PRESENT: only a live occupant may scan the LAN.
    const ctx = setup({ callerOffLan: true });

    await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });

  it('skips occupant tracing without failing the scan when the lease lookup errors', async () => {
    // Rows AND an error: a failed read is not trusted even when it hands back data.
    const ctx = setup({ leaseReadFails: true });

    const result = await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(result.status).toBe(200);
    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });
});
