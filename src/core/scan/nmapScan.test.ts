import { describe, expect, it, vi } from 'vitest';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { handleNmapScan, type NmapScanDeps } from './nmapScan.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { buildRemoteHostFs } from '../generation/remoteHostFs.js';
import { buildApGatewayBaseFs } from '../generation/routerFs.js';
import { seedApGatewayHostname } from '../generation/gatewayHostname.js';
import { hostMachineId } from '../generation/remoteHostId.js';
import {
  resolveDeepGatewayIdentity,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity.js';
import { chainLinks, type ChainLink } from '../generation/lanTopology.js';
import { generateDeepLayer } from '../generation/generateDeepLayer.js';
import { buildDeepHostFs } from '../generation/deepHostFs.js';
import { crackableEssidPool } from '../generation/generateWifi.js';
import { computeInnerGatewayId, computeApGatewayId } from '../identity/router.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { materializeWorkstationFs, type OwnerPatchRow } from '../network/materializeWorkstationFs.js';
import { readOpenPorts } from '../services/pidfile.js';
import { md5 } from '../generation/md5.js';
import { formatNmapScanAggregate, KERN_LOG_OWNER, KERN_LOG_PERMISSIONS } from '../logging/kernLog.js';
import { asGameTime, asPlayerKeyHex } from '../types.js';
import type { ScanOccupant } from './nmapScan.js';
import type { LanLeaseRow } from '../network/lanAddress.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { logRead } from '../../test/factories/logRows.js';

/**
 * `handleNmapScan` is the server-side scan action: it verifies the signed
 * envelope, REGENERATES the caller's own LAN from the verified pubkey + essid,
 * and — server-internal — appends ONE aggregate `/var/log/kern.log` line to EACH
 * scanned host (the SSH-epic `appendMachineLog` pattern). Per-host, never per
 * probe; every up host except the player's own workstation (which is keyed by a
 * different machine_id); the line lists that host's own open ports. The line lands
 * on the host's shared journal keyed by machine_id and the ESSID's own STABLE writer
 * key, not the caller's. These boxes are
 * regenerated from the ESSID and shared by every occupant, so a row per scanner would
 * let replay keep only whichever swept last; the scanner is named by the line's source
 * address instead. A fellow occupant's REAL workstation is the other case and keeps its
 * owner's key, which is the same rule seen from the other side: whoever the box belongs
 * to owns its log.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// 2026-06-07 14:32:01 UTC — the server clock the kern.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 7, 14, 32, 1);
// The lease the scanner holds on the network at home — the address every own-LAN trace
// names, read by the server from the scanner's key rather than taken from the client.
const SOURCE_OCTET = 50;
const SOURCE_IP = `${generateHomeLan(ESSID).subnet}.${SOURCE_OCTET}`;

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
    // Default: the scanner stands at home on this ESSID on its lease, holding no shell.
    findActiveSession: async () => ({ data: null, error: null }),
    findHomeVantage: async () => ({ data: { essid: ESSID, octet: SOURCE_OCTET }, error: null }),
    findWorkstationLease: async () => ({ data: null, error: null }),
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
) => signRequest(id, 'nmapScan', { essid: ESSID, target, ...over });

describe('whose row an own-LAN scan trace accretes under', () => {
  it("files a generated box under the network's own key, not the scanner", async () => {
    // A generated sibling is ESSID-shared: regenerated from the ESSID with an id that does
    // not depend on who is asking, so every occupant of this WiFi scans the identical box.
    // `patches` is keyed `(machine_id, path, writer_key)` and a log patch carries the whole
    // file, so a row per scanner means replay keeps only whichever swept last.
    //
    // It also has to agree with the doors that write this same box: a `mysql` login and an
    // `ssh` reach file into their own logs on this very machine id under the ESSID's key,
    // and a scan that kept the caller's would be the one writer out of step.
    const id = identityOffTheGeneratedLan();
    const { deps, upsertPatch } = makeDeps();
    const logged = loggedHostsOf(id.publicKeyHex);

    await handleNmapScan(envelope(id, `${subnetOf()}.1-254`), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(logged.length);
    for (const [row] of upsertPatch.mock.calls) {
      expect(row.writer_key).toBe(apGatewayLogWriterKey(ESSID));
    }
  });
});

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
        writer_key: apGatewayLogWriterKey(ESSID),
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
      readLog: vi.fn(async () => logRead('PRIOR LINE\n')),
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

  it('refuses a target on a network the scanner does not reach, writing nothing', async () => {
    const id = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, '10.0.0.1-254'), deps);

    expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
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
      signRequest(id, 'nmapScan', { essid: ESSID }),
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

  it('records the source as "unknown" when the scanner holds no lease on the network', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: ESSID, octet: null }, error: null }),
    });

    const result = await handleNmapScan(envelope(id, host.ip), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 1 });
    expect(upsertPatch.mock.calls[0]![0].content).toContain('Port scan from unknown —');
  });

  it('records the address the server places the scanner at, not one the client claims', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, host.ip, { source_ip: '203.0.113.222' }), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedKernLine(host)}\n`);
  });

  it('logs nothing for a network the scanner is not standing on', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: 'SOME-OTHER-WIFI', octet: 40 }, error: null }),
    });

    const result = await handleNmapScan(envelope(id, host.ip), deps);

    expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('logs nothing for a scanner who is on no network at all', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: null, error: null }),
    });

    const result = await handleNmapScan(envelope(id, host.ip), deps);

    expect(result).toEqual({ status: 403, body: { error: 'caller_not_on_network' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('returns 500 rather than a trace it could not place', async () => {
    const id = generateIdentity();
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleNmapScan(envelope(id, host.ip), deps);

    expect(result).toEqual({ status: 500, body: { error: 'vantage_lookup_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
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
    const leaseRows = over.leases?.({ alice, bob }) ?? [
      { owner_key: alice.publicKeyHex, octet: leasedOctets.alice },
      { owner_key: bob.publicKeyHex, octet: leasedOctets.bob },
    ];
    // The lease reader deps actually get — returned below so a test can retarget it.
    const listLeasesByEssid =
      over.listLeasesByEssid ??
      vi.fn(async () => ({
        data: leaseRows,
        error: over.leaseReadFails === true ? new Error('db down') : null,
      }));
    // Where the server places a scanner at home: on this ESSID while it occupies it, on
    // the octet it leased — or nowhere, for a stranger or a player who left.
    const findHomeVantage: NmapScanDeps['findHomeVantage'] = async (ownerKey) => ({
      data:
        ownerKey === bob.publicKeyHex && over.callerOffLan !== true
          ? {
              essid: ESSID,
              octet: leaseRows.find((lease) => lease.owner_key === ownerKey)?.octet ?? null,
            }
          : null,
      error: null,
    });
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage,
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

  it('refuses a caller who is not on the ESSID, tracing nobody', async () => {
    const ctx = setup({ caller: 'stranger' });

    const result = await handleNmapScan(envelope(ctx.caller, ctx.aLan), ctx.deps);

    expect(result).toEqual({ status: 403, body: { error: 'caller_not_on_network' } });
    expect(ctx.upsertPatch).not.toHaveBeenCalled();
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

    expect(result.status).toBe(403);
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

    const result = await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(result).toEqual({ status: 403, body: { error: 'caller_not_on_network' } });
    expect(ctx.upsertPatch).not.toHaveBeenCalled();
  });

  it('skips occupant tracing without failing the scan when the lease lookup errors', async () => {
    // Rows AND an error: a failed read is not trusted even when it hands back data.
    const ctx = setup({ leaseReadFails: true });

    const result = await handleNmapScan(envelope(ctx.bob, ctx.aLan), ctx.deps);

    expect(result.status).toBe(200);
    expect(traceOn(ctx.upsertPatch, ctx.aWs)).toBeUndefined();
  });
});

/**
 * A shell on a box is a place to stand: a scan typed into it sweeps that box's network
 * and every trace it leaves names that box's own address there. Both come off the
 * session row the server holds, so a caller who stands on a network without occupying
 * it scans it all the same, and one who names a box they hold no shell on scans nothing.
 */
describe('handleNmapScan — from a shell held on a box', () => {
  const hopFixture = () => {
    const stranger = generateIdentity();
    const hop = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine')!;
    const hopMachineId = resolveLanHostIdentity(hop, ESSID).machineId;
    const shellOn = (essid: string): Partial<NmapScanDeps> => ({
      findActiveSession: async () => ({
        data: { username: 'root', userType: 'root', essid },
        error: null,
      }),
      // The caller lives on no network of their own; only the shell places them.
      findHomeVantage: async () => ({ data: null, error: null }),
    });
    const hopEnvelope = (target: string) =>
      envelope(stranger, target, { caller_machine_id: hopMachineId });
    return { stranger, hop, hopMachineId, shellOn, hopEnvelope };
  };

  it("names the hop's own LAN address on every host the sweep touches", async () => {
    const { hop, shellOn, hopEnvelope } = hopFixture();
    const { deps, upsertPatch } = makeDeps(shellOn(ESSID));

    const result = await handleNmapScan(hopEnvelope(`${subnetOf()}.1-254`), deps);

    expect(result.status).toBe(200);
    expect(upsertPatch).toHaveBeenCalled();
    for (const [row] of upsertPatch.mock.calls) {
      expect(row.content).toContain(`Port scan from ${hop.ip} —`);
    }
  });

  it("traces a fellow occupant from the hop's address, though the caller occupies nothing", async () => {
    const { hop, shellOn, hopEnvelope } = hopFixture();
    const alice = generateIdentity();
    const aWs = `workstation-${alice.publicKeyHex.slice(0, 8)}`;
    const occAlice = occupantRow(alice, aWs, 'skylab');
    const aOctet = hop.ip.endsWith('.200') ? 201 : 200;
    const aLan = `${subnetOf()}.${aOctet}`;
    const { deps, upsertPatch } = makeDeps({
      ...shellOn(ESSID),
      listOccupantsByEssid: async () => ({ data: [occAlice], error: null }),
      listLeasesByEssid: async () => ({
        data: [{ owner_key: alice.publicKeyHex, octet: aOctet }],
        error: null,
      }),
      findPatches: async () => ({ data: [wsSshdUp], error: null }),
    });

    await handleNmapScan(hopEnvelope(aLan), deps);

    expect(traceOn(upsertPatch, aWs)?.content).toBe(
      `${expectedOccupantLine(occAlice, [wsSshdUp], hop.ip)}\n`,
    );
  });

  it('refuses a sweep of a network other than the one the hop stands on', async () => {
    const { shellOn, hopEnvelope } = hopFixture();
    const { deps, upsertPatch } = makeDeps(shellOn('RIDGEMONT-OFFICE'));

    const result = await handleNmapScan(hopEnvelope(`${subnetOf()}.1-254`), deps);

    expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller naming a box they hold no shell on', async () => {
    const { hopEnvelope } = hopFixture();
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: null, error: null }),
    });

    const result = await handleNmapScan(hopEnvelope(`${subnetOf()}.1-254`), deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

/**
 * A deep layer is swept by the same action as the LAN. Which layer the target is on
 * decides which hosts are logged; where the caller stands decides the address each line
 * names — the box's own address on its layer, a gateway's `.1` on the layer it fronts,
 * or, on a layer above, the gateway the scan left through.
 */
describe('handleNmapScan — on a deep layer', () => {
  // Three gateways deep: an inner router on the LAN, a deep router behind it, and a
  // second deep router behind that.
  const [inner, middle] = chainLinks(ESSID);
  const innerSwitch = chainLinks(ESSID).find(
    (link) => link.host.kind === 'switch' && link.parentMachineId === null,
  );

  const layerOf = (link: ChainLink | undefined, essid = ESSID) => {
    if (link === undefined) throw new Error(`${essid} has no such gateway`);
    return generateDeepLayer(
      essid,
      { machineId: link.machineId, kind: link.host.kind },
      { hangsChild: link.hangsChild },
    );
  };

  type DeepHost = { host: LanHost; machineId: string; ports: readonly number[] };

  /** The hosts on the layer `link` fronts, each with the ports it shows past `denied`. */
  const hostsOnLayerOf = (
    link: ChainLink | undefined,
    essid = ESSID,
    denied: ReadonlySet<number> = new Set(),
  ): readonly DeepHost[] => {
    const layer = layerOf(link, essid);
    const onLayer = layer.childGateway === null ? [layer.host] : [layer.host, layer.childGateway];
    return onLayer.map((host) => {
      const identity =
        host.kind === 'machine'
          ? { machineId: hostMachineId(host, essid), baseFs: buildDeepHostFs(essid, host) }
          : resolveDeepGatewayIdentity(essid, link?.machineId ?? '', host.ip, host.kind);
      const ports = readOpenPorts(identity.baseFs)
        .map((open) => open.port)
        .filter((port) => !denied.has(port));
      return { host, machineId: identity.machineId, ports };
    });
  };

  const npcOn = (link: ChainLink | undefined): DeepHost => {
    const npc = hostsOnLayerOf(link).find((entry) => entry.host.kind === 'machine');
    if (npc === undefined) throw new Error('the layer has no host');
    return npc;
  };

  const deepLine = (sourceIp: string, entry: DeepHost): string =>
    `${formatNmapScanAggregate({
      time: asGameTime(FIXED_NOW),
      hostname: entry.host.hostname,
      sourceIp,
      probedPorts: entry.ports,
    })}\n`;

  /** A caller whose only place is the shell they hold; they occupy no network. */
  const shellOn = (essid = ESSID): Partial<NmapScanDeps> => ({
    findActiveSession: async () => ({
      data: { username: 'root', userType: 'root', essid },
      error: null,
    }),
    findHomeVantage: async () => ({ data: null, error: null }),
  });
  const scanFrom = (machineId: string | undefined, target: string, essid = ESSID) =>
    signRequest(generateIdentity(), 'nmapScan', {
      essid,
      target,
      caller_machine_id: machineId ?? '',
    });

  it('logs every host on the layer an inner gateway fronts, from that layer’s .1', async () => {
    const layer = layerOf(inner);
    const hosts = hostsOnLayerOf(inner);
    const { deps, upsertPatch } = makeDeps(shellOn());

    const result = await handleNmapScan(
      scanFrom(inner?.machineId, `${layer.subnet}.1-254`),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: hosts.length } });
    expect(upsertPatch).toHaveBeenCalledTimes(hosts.length);
    for (const entry of hosts) {
      expect(traceOn(upsertPatch, entry.machineId)).toEqual({
        writer_key: apGatewayLogWriterKey(ESSID),
        machine_id: entry.machineId,
        path: '/var/log/kern.log',
        content: deepLine(`${layer.subnet}.1`, entry),
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
        node_type: 'file',
      });
    }
  });

  it('logs a sweep from a deep host under its own address on its layer', async () => {
    const layer = layerOf(inner);
    const hosts = hostsOnLayerOf(inner);
    const { deps, upsertPatch } = makeDeps(shellOn());

    await handleNmapScan(
      scanFrom(hostMachineId(layer.host, ESSID), `${layer.subnet}.1-254`),
      deps,
    );

    expect(upsertPatch).toHaveBeenCalledTimes(hosts.length);
    for (const entry of hosts) {
      expect(traceOn(upsertPatch, entry.machineId)?.content).toBe(deepLine(layer.host.ip, entry));
    }
  });

  it('logs a deep gateway’s sweep of the layer it sits on under its own address there', async () => {
    const npc = npcOn(inner);
    const { deps, upsertPatch } = makeDeps(shellOn());

    await handleNmapScan(scanFrom(middle?.machineId, npc.host.ip), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]?.[0].content).toBe(deepLine(middle?.host.ip ?? '', npc));
  });

  it('logs a deep gateway’s sweep of the layer it fronts from that layer’s .1', async () => {
    const layer = layerOf(middle);
    const npc = npcOn(middle);
    const { deps, upsertPatch } = makeDeps(shellOn());

    await handleNmapScan(scanFrom(middle?.machineId, npc.host.ip), deps);

    expect(upsertPatch.mock.calls[0]?.[0].content).toBe(deepLine(`${layer.subnet}.1`, npc));
  });

  it('logs a sweep of a layer above under the gateway the scan left through', async () => {
    const below = layerOf(middle);
    const npc = npcOn(inner);
    const { deps, upsertPatch } = makeDeps(shellOn());

    await handleNmapScan(scanFrom(hostMachineId(below.host, ESSID), npc.host.ip), deps);

    expect(upsertPatch.mock.calls[0]?.[0].content).toBe(deepLine(middle?.host.ip ?? '', npc));
  });

  it('logs a deep host’s sweep of the LAN under the inner gateway’s LAN address', async () => {
    const layer = layerOf(inner);
    const { deps, upsertPatch } = makeDeps(shellOn());

    await handleNmapScan(
      scanFrom(hostMachineId(layer.host, ESSID), `${subnetOf()}.1-254`),
      deps,
    );

    expect(upsertPatch).toHaveBeenCalled();
    for (const [row] of upsertPatch.mock.calls) {
      expect(row.content).toContain(`Port scan from ${inner?.host.ip} —`);
    }
  });

  it('appends to what the host’s log already holds', async () => {
    const layer = layerOf(inner);
    const npc = npcOn(inner);
    const { deps, upsertPatch } = makeDeps({
      ...shellOn(),
      readLog: vi.fn(async () => logRead('PRIOR LINE\n')),
    });

    await handleNmapScan(scanFrom(inner?.machineId, npc.host.ip), deps);

    expect(upsertPatch.mock.calls[0]?.[0].content).toBe(
      `PRIOR LINE\n${deepLine(`${layer.subnet}.1`, npc)}`,
    );
  });

  it('still answers when a log write fails', async () => {
    const layer = layerOf(inner);
    const { deps } = makeDeps({
      ...shellOn(),
      upsertPatch: vi.fn(async () => {
        throw new Error('db down');
      }),
    });

    const result = await handleNmapScan(
      scanFrom(inner?.machineId, `${layer.subnet}.1-254`),
      deps,
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, hostsLogged: hostsOnLayerOf(inner).length },
    });
  });

  it('logs a child switch on its own switch box, not as the generic host at its address', async () => {
    const essid = crackableEssidPool.find(
      (candidate) => layerOf(chainLinks(candidate)[0], candidate).childGateway?.kind === 'switch',
    );
    if (essid === undefined) throw new Error('no network fronts a child switch');
    const [door] = chainLinks(essid);
    const child = hostsOnLayerOf(door, essid).find((entry) => entry.host.kind === 'switch');
    if (child === undefined) throw new Error('the door fronts no switch');
    expect(child.machineId).not.toBe(hostMachineId(child.host, essid));
    const { deps, upsertPatch } = makeDeps(shellOn(essid));

    await handleNmapScan(scanFrom(door?.machineId, child.host.ip, essid), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]?.[0].machine_id).toBe(child.machineId);
  });

  describe('a switch’s port denies', () => {
    const aclPatch = (content: string): OwnerPatchRow => ({
      path: '/etc/switch/acl.conf',
      content,
      owner: 'root',
      permissions: null,
      node_type: 'file',
      updated_at: '2026-06-19T00:00:00.000Z',
      writer_key: 'a'.repeat(64),
    });

    it('drop a denied port from the log, and stop once the deny is gone', async () => {
      const npc = npcOn(innerSwitch);
      expect(npc.ports).toContain(22);

      const denied = makeDeps({
        ...shellOn(),
        findPatches: vi.fn(async () => ({ data: [aclPatch('deny 22')], error: null })),
      });
      await handleNmapScan(scanFrom(innerSwitch?.machineId, npc.host.ip), denied.deps);
      expect(traceOn(denied.upsertPatch, npc.machineId)?.content).not.toContain(
        'probed ports 22',
      );

      const opened = makeDeps({
        ...shellOn(),
        findPatches: vi.fn(async () => ({ data: [aclPatch('deny 9999')], error: null })),
      });
      await handleNmapScan(scanFrom(innerSwitch?.machineId, npc.host.ip), opened.deps);
      expect(traceOn(opened.upsertPatch, npc.machineId)?.content).toContain('probed ports 22');
    });

    it('surface a 500 when the switch’s journal cannot be read', async () => {
      const npc = npcOn(innerSwitch);
      const findPatches = vi.fn(async () => ({ data: null, error: new Error('db down') }));
      const { deps, upsertPatch } = makeDeps({ ...shellOn(), findPatches });

      const result = await handleNmapScan(scanFrom(innerSwitch?.machineId, npc.host.ip), deps);

      expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
      expect(findPatches).toHaveBeenCalledWith({ machine_id: innerSwitch?.machineId });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('are not read for a router, which filters nothing', async () => {
      const layer = layerOf(inner);
      const findPatches = vi.fn(async () => ({ data: null, error: new Error('db down') }));
      const { deps } = makeDeps({ ...shellOn(), findPatches });

      const result = await handleNmapScan(
        scanFrom(inner?.machineId, `${layer.subnet}.1-254`),
        deps,
      );

      expect(result.status).toBe(200);
      expect(findPatches).not.toHaveBeenCalled();
    });
  });

  describe('who may ask', () => {
    it('refuses a gateway the caller holds no shell on, logging nothing', async () => {
      const layer = layerOf(inner);
      const { deps, upsertPatch } = makeDeps({
        findHomeVantage: async () => ({ data: null, error: null }),
      });

      const result = await handleNmapScan(
        scanFrom(inner?.machineId, `${layer.subnet}.1-254`),
        deps,
      );

      expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('refuses a layer further down than the one the box fronts', async () => {
      const below = layerOf(middle);
      const { deps, upsertPatch } = makeDeps(shellOn());

      const result = await handleNmapScan(
        scanFrom(inner?.machineId, `${below.subnet}.1-254`),
        deps,
      );

      expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('refuses a deep layer to a caller at home on their own box', async () => {
      const layer = layerOf(inner);
      const { deps, upsertPatch } = makeDeps();

      const result = await handleNmapScan(
        envelope(generateIdentity(), `${layer.subnet}.1-254`),
        deps,
      );

      expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });
  });
});
