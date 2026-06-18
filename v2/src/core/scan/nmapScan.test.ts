import { describe, expect, it, vi } from 'vitest';
import { handleNmapScan, type NmapScanDeps } from './nmapScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
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

const portsOf = (pubkey: string, host: LanHost): readonly number[] =>
  readOpenPorts(buildRemoteHostFs(pubkey, ESSID, host)).map((port) => port.port);

/** The kern.log line the server should stamp for a scan of `host` at FIXED_NOW. */
const expectedKernLine = (pubkey: string, host: LanHost): string =>
  formatNmapScanAggregate({
    time: asGameTime(FIXED_NOW),
    hostname: host.hostname,
    sourceIp: SOURCE_IP,
    probedPorts: portsOf(pubkey, host),
  });

// A FIXED identity (found once via a dev-time search, then hardcoded — no run-time
// loop) whose deterministic LAN includes a host that runs a service, so a test can
// pin that the host's REAL port reaches the log line. Verified: on ESSID
// 'BEAN-THERE-WIFI' this identity's gateway 192.168.218.1 runs ssh (port 22).
const PORTED_IDENTITY: ReturnType<typeof generateIdentity> = {
  publicKeyHex: asPlayerKeyHex('7af20db688cbc12e66e5a499e232818a6a63011a641493c6cbc821a377cbbb32'),
  privateKeyHex: '88fd07c8eea8d81329435d6eefacf423aae078245e5a9b71940e1653573d7cf7',
};
const PORTED_HOST: LanHost = { ip: '192.168.218.1', hostname: 'gateway', kind: 'router' };
const PORTED_SUBNET = '192.168.218';

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
      expect(upsertPatch.mock.calls[index]![0]).toEqual({
        writer_key: id.publicKeyHex,
        machine_id: hostMachineId(host, ESSID),
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
    const host = loggedHostsOf(id.publicKeyHex)[0]!;
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
