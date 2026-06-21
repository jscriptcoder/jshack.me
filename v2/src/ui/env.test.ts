import { describe, expect, it } from 'vitest';
import { buildCommandEnv } from './env';
import { homePathFor, SEED_CONFIG, seedFs, seedSession } from './seed';
import { generateIdentity } from '../core/identity/identity';
import { asAbsPath } from '../core/types';
import { buildColdStartConnectivity, type NetworkInterface } from '../core/network/interfaces';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import { generateWifi } from '../core/generation/generateWifi';
import type { LogApi, PatchApi, ScanRecordParams } from '../core/commands/types';

const noopPatches: PatchApi = {
  write: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  mkdir: async () => ({ ok: true }),
};

const noopLog: LogApi = {
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
};

const seedHome = homePathFor(SEED_CONFIG.username);
const seedConnectivity = () => buildColdStartConnectivity('a'.repeat(64));
const seedWifi = () => generateWifi('a'.repeat(64));

const seedEnv = (userType: 'guest' | 'user' | 'root' = 'user') =>
  buildCommandEnv({
    identity: generateIdentity(),
    session: { ...seedSession(generateIdentity(), SEED_CONFIG), userType },
    root: seedFs(SEED_CONFIG, generateIdentity()),
    cwd: () => seedHome,
    onCwdChange: () => undefined,
    patches: noopPatches,
    log: noopLog,
    connectivity: seedConnectivity,
    onInterfaceChange: () => undefined,
    wifiNetworks: seedWifi,
    prompt: async () => '',
    onPushSession: () => undefined,
    hopChain: [],
    onPopSession: () => undefined,
    signal: new AbortController().signal,
  });

describe('buildCommandEnv', () => {
  it('reads /etc/passwd at the session user tier', () => {
    const result = seedEnv('user').fs.read(asAbsPath('/etc/passwd'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a readable /etc/passwd');
    expect(result.content).toContain('alice');
  });

  it('denies /etc/passwd to a guest-tier session', () => {
    expect(seedEnv('guest').fs.read(asAbsPath('/etc/passwd'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  it('exposes the provided session and working directory', () => {
    const session = seedSession(generateIdentity(), SEED_CONFIG);
    const env = buildCommandEnv({
      identity: generateIdentity(),
      session,
      root: seedFs(SEED_CONFIG, generateIdentity()),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: new AbortController().signal,
    });

    expect(env.session).toBe(session);
    expect(env.fs.cwd()).toBe(seedHome);
  });

  it('exposes the connectivity reader as an offline network view at cold start', () => {
    const env = seedEnv();
    expect(env.network.interfaces().map((iface) => iface.name)).toEqual(['lo', 'eth0', 'wlan0']);
    expect(env.network.isOnline()).toBe(false);
  });

  it('exposes the seeded WiFi networks through the network view', () => {
    expect(seedEnv().network.wifiNetworks()).toEqual(seedWifi());
  });

  it('wires homeNetwork.join to the identity-seeded assignment', async () => {
    const identity = generateIdentity();
    const env = buildCommandEnv({
      identity,
      session: seedSession(identity, SEED_CONFIG),
      root: seedFs(SEED_CONFIG, identity),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: new AbortController().signal,
    });

    // The seam resolves to exactly the deterministic core derivation for this
    // identity — so a fresh connect and a reload rehydration agree on the IP.
    await expect(env.homeNetwork.join('BEAN-THERE-WIFI')).resolves.toEqual(
      assignHomeNetwork(identity.publicKeyHex, 'BEAN-THERE-WIFI'),
    );
  });

  it('wires homeNetwork.leave to the supplied disconnect seam', () => {
    const leaveCalls: string[] = [];
    const identity = generateIdentity();
    const env = buildCommandEnv({
      identity,
      session: seedSession(identity, SEED_CONFIG),
      root: seedFs(SEED_CONFIG, identity),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      onHomeNetworkLeave: (essid) => leaveCalls.push(essid),
      signal: new AbortController().signal,
    });

    env.homeNetwork.leave('BEAN-THERE-WIFI');

    expect(leaveCalls).toEqual(['BEAN-THERE-WIFI']);
  });

  it('defaults homeNetwork.leave to a no-op when the seam is unwired', () => {
    expect(() => seedEnv().homeNetwork.leave('BEAN-THERE-WIFI')).not.toThrow();
  });

  it('provides an abort-aware sleep that resolves when not aborted', async () => {
    // A zero-delay sleep through the real seam should resolve, proving the
    // env wires a working sleep rather than a stub.
    await expect(seedEnv().sleep(0)).resolves.toBeUndefined();
  });

  it('wires the provided signal into env.signal and the sleep, so aborting rejects it', async () => {
    const controller = new AbortController();
    const env = buildCommandEnv({
      identity: generateIdentity(),
      session: seedSession(generateIdentity(), SEED_CONFIG),
      root: seedFs(SEED_CONFIG, generateIdentity()),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: controller.signal,
    });

    expect(env.signal).toBe(controller.signal);
    const sleeping = env.sleep(10_000).catch((reason: unknown) => reason);
    controller.abort();
    expect(await sleeping).toBe(controller.signal.reason);
  });

  it('routes setInterface through to the onInterfaceChange writer', () => {
    const calls: Array<readonly [string, NetworkInterface]> = [];
    const env = buildCommandEnv({
      identity: generateIdentity(),
      session: seedSession(generateIdentity(), SEED_CONFIG),
      root: seedFs(SEED_CONFIG, generateIdentity()),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: (name, iface) => calls.push([name, iface]),
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: new AbortController().signal,
    });

    const wlan0 = seedConnectivity().interfaces.get('wlan0')!;
    if (wlan0.kind !== 'wireless') throw new Error('unreachable');
    env.setInterface('wlan0', { ...wlan0, monitorMode: true });

    expect(calls).toEqual([['wlan0', { ...wlan0, monitorMode: true }]]);
  });

  it('exposes the injected log API', () => {
    expect(seedEnv().log).toBe(noopLog);
  });

  it('routes scan.record through the injected onScanRecord seam', async () => {
    const recorded: ScanRecordParams[] = [];
    const env = buildCommandEnv({
      identity: generateIdentity(),
      session: seedSession(generateIdentity(), SEED_CONFIG),
      root: seedFs(SEED_CONFIG, generateIdentity()),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: new AbortController().signal,
      onScanRecord: async (params) => {
        recorded.push(params);
      },
    });

    await env.scan.record({ essid: 'E', target: '192.168.1.1-254', sourceIp: '192.168.1.50' });

    expect(recorded).toEqual([{ essid: 'E', target: '192.168.1.1-254', sourceIp: '192.168.1.50' }]);
  });

  it('routes scan.resolveOccupants through the injected onScanResolveOccupants seam', async () => {
    const requested: string[] = [];
    const occupants = [
      { workstation_machine_id: 'skylab-aaaa', localIp: '192.168.50.88', machineName: 'alice-rig' },
    ];
    const env = buildCommandEnv({
      identity: generateIdentity(),
      session: seedSession(generateIdentity(), SEED_CONFIG),
      root: seedFs(SEED_CONFIG, generateIdentity()),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
      log: noopLog,
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: new AbortController().signal,
      onScanResolveOccupants: async (essid) => {
        requested.push(essid);
        return occupants;
      },
    });

    await expect(env.scan.resolveOccupants('BEAN-THERE-WIFI')).resolves.toEqual(occupants);
    expect(requested).toEqual(['BEAN-THERE-WIFI']);
  });

  it('defaults scan.resolveOccupants to an empty list when the seam is unwired', async () => {
    // The occupant read is ADDITIVE — absent the server seam, an own-LAN scan still
    // works, it just shows no fellow players (mirrors homeNetwork.join's local fallback).
    await expect(seedEnv().scan.resolveOccupants('BEAN-THERE-WIFI')).resolves.toEqual([]);
  });
});
