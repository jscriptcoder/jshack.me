import { describe, expect, it, vi } from 'vitest';
import { handleNmapScan, type NmapScanDeps } from './nmapScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { buildRouterBaseFs, seedRouterHostname } from '../generation/routerFs';
import { hostMachineId } from '../generation/remoteHostId';
import { computeRouterId } from '../identity/router';
import { assignHomeNetwork } from '../network/homeNetwork';
import { readOpenPorts } from '../services/pidfile';
import { formatNmapScanAggregate, KERN_LOG_OWNER, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { asGameTime, asPlayerKeyHex } from '../types';
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
  const deps: NmapScanDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    readLog,
    upsertPatch,
    ...over,
  };
  return { deps, upsertPatch, readLog };
};

const subnetOf = (pubkey: string): string => generateHomeLan(pubkey, ESSID).subnet;
const selfIpOf = (pubkey: string): string => assignHomeNetwork(pubkey, ESSID).localIp;

/** Every host the server should log on for a full-range scan: all up hosts
 *  except the player's own workstation, in ascending-octet (lan) order. */
const loggedHostsOf = (pubkey: string): readonly LanHost[] => {
  const selfIp = selfIpOf(pubkey);
  return generateHomeLan(pubkey, ESSID).hosts.filter((host) => host.ip !== selfIp);
};

/** The first generic NPC sibling (a `kind:'machine'` host that is not the player's
 *  own workstation) — the coordinate-keyed path, distinct from the `.1` router. */
const firstSiblingOf = (pubkey: string): LanHost =>
  loggedHostsOf(pubkey).find((host) => host.kind === 'machine')!;

/** The `.1` gateway host (the only `kind:'router'` host on the LAN). */
const gatewayOf = (pubkey: string): LanHost =>
  generateHomeLan(pubkey, ESSID).hosts.find((host) => host.kind === 'router')!;

// The ports the server logs for a host, mirroring production's FS choice: the `.1`
// router's OWN services come from its real base FS; every NPC sibling reads its
// generic coordinate FS.
const portsOf = (pubkey: string, host: LanHost): readonly number[] =>
  readOpenPorts(
    host.kind === 'router' ? buildRouterBaseFs(pubkey) : buildRemoteHostFs(pubkey, ESSID, host),
  ).map((port) => port.port);

/** The kern.log line the server should stamp for a scan of `host` at FIXED_NOW. */
const expectedKernLine = (pubkey: string, host: LanHost): string =>
  formatNmapScanAggregate({
    time: asGameTime(FIXED_NOW),
    hostname: host.hostname,
    sourceIp: SOURCE_IP,
    probedPorts: portsOf(pubkey, host),
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
  hostname: seedRouterHostname(PORTED_IDENTITY.publicKeyHex),
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
    const id = generateIdentity();
    const { deps, upsertPatch } = makeDeps();
    const logged = loggedHostsOf(id.publicKeyHex);

    const result = await handleNmapScan(envelope(id, `${subnetOf(id.publicKeyHex)}.1-254`), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, hostsLogged: logged.length } });
    expect(upsertPatch).toHaveBeenCalledTimes(logged.length);
    logged.forEach((host, index) => {
      // The `.1` gateway logs on the REAL router record (the one `ssh root@.1`
      // resolves to); a generic NPC sibling logs on its coordinate id (Story 6.4).
      const expectedMachineId =
        host.kind === 'router' ? computeRouterId(id.publicKeyHex) : hostMachineId(host, ESSID);
      expect(upsertPatch.mock.calls[index]![0]).toEqual({
        writer_key: id.publicKeyHex,
        machine_id: expectedMachineId,
        path: '/var/log/kern.log',
        content: `${expectedKernLine(id.publicKeyHex, host)}\n`,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
        node_type: 'file',
      });
    });
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
      `${expectedKernLine(id.publicKeyHex, host)}\n`,
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
      `PRIOR LINE\n${expectedKernLine(id.publicKeyHex, host)}\n`,
    );
  });

  it('writes nothing when the single target octet has no host (host down)', async () => {
    const id = generateIdentity();
    const subnet = subnetOf(id.publicKeyHex);
    const taken = new Set(generateHomeLan(id.publicKeyHex, ESSID).hosts.map((host) => host.ip));
    const freeOctet = Array.from({ length: 253 }, (_, index) => index + 2).find(
      (octet) => !taken.has(`${subnet}.${octet}`),
    )!;
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, `${subnet}.${freeOctet}`), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('skips the player own workstation (it is keyed by a different machine_id)', async () => {
    const id = generateIdentity();
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
    const signed = envelope(id, `${subnetOf(id.publicKeyHex)}.1-254`);
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
      envelope(id, `${subnetOf(id.publicKeyHex)}.1-254`, { player_key: 'attacker-key' }),
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
    const ports = portsOf(PORTED_IDENTITY.publicKeyHex, PORTED_HOST);
    // Guards the fixture's premise: if generation ever stops giving this host a
    // service, this fails loudly instead of silently testing a 0-port line.
    expect(ports).toContainEqual(22);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(PORTED_IDENTITY, PORTED_HOST.ip), deps);

    const content = upsertPatch.mock.calls[0]![0].content;
    expect(content).toBe(`${expectedKernLine(PORTED_IDENTITY.publicKeyHex, PORTED_HOST)}\n`);
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
 * reached at run time via `ssh root@.1` → `computeRouterId(caller)`; its coordinate
 * `hostMachineId('<router name>', essid)` is a DEAD-END record nobody reads. So the
 * scan line for the gateway host must land on `computeRouterId(caller)`, while a
 * generic NPC sibling keeps its coordinate `hostMachineId`.
 */
// A FIXED identity (found once via a dev-time search, then hardcoded) whose `.1`
// router's OWN services (`buildRouterBaseFs` → always `sshd:22`) DIFFER from its
// generic coordinate FS (`buildRemoteHostFs` → no open ports here) — so a test can
// prove the logged line lists the ROUTER's real ports, not the dead generic ones.
const ROUTER_PORTS_IDENTITY: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('d1f9513763e20bc7d3c6579b2f9159972c2d79e0232c16358573e67d80f0d1d1'),
  privateKeyHex: 'b06229c561e83d6513a217c0e80760adc729cf73f2a787c554af70464b10ec14',
};

describe('handleNmapScan — own-LAN .1 scan → real router record (Story 6.4)', () => {
  it('logs the .1 gateway scan on computeRouterId(caller), not the dead-end hostMachineId', async () => {
    const id = generateIdentity();
    const gateway = gatewayOf(id.publicKeyHex);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, gateway.ip), deps);

    const routerId = computeRouterId(id.publicKeyHex);
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

  it('logs the router scan with the router real ports (sshd:22), not the dead generic host FS', async () => {
    const id = ROUTER_PORTS_IDENTITY;
    const gateway = gatewayOf(id.publicKeyHex);
    const realPorts = readOpenPorts(buildRouterBaseFs(id.publicKeyHex)).map((port) => port.port);
    const genericPorts = readOpenPorts(buildRemoteHostFs(id.publicKeyHex, ESSID, gateway)).map(
      (port) => port.port,
    );
    // Fixture premise: the router's own services (always sshd:22) genuinely DIFFER
    // from the generic coordinate FS — so the content assertion distinguishes the
    // two sources rather than passing by coincidence.
    expect(realPorts).toContain(22);
    expect(realPorts).not.toEqual(genericPorts);
    const { deps, upsertPatch } = makeDeps();

    await handleNmapScan(envelope(id, gateway.ip), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${expectedKernLine(id.publicKeyHex, gateway)}\n`);
  });

  it('does not log the player own workstation on the router record (self still skipped)', async () => {
    const id = generateIdentity();
    const selfIp = selfIpOf(id.publicKeyHex);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleNmapScan(envelope(id, selfIp), deps);

    expect(result.body).toEqual({ ok: true, hostsLogged: 0 });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
