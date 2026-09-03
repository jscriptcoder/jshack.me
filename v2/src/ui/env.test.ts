import { describe, expect, it } from 'vitest';
import { buildCommandEnv } from './env';
import { homePathFor, SEED_CONFIG, seedFs, seedSession } from './seed';
import { generateIdentity } from '../core/identity/identity';
import { asAbsPath } from '../core/types';
import { buildColdStartConnectivity, type NetworkInterface } from '../core/network/interfaces';
import { generateWifi } from '../core/generation/generateWifi';
import type { LogApi, PatchApi, ScanRecordParams } from '../core/commands/types';

const noopPatches: PatchApi = {
  write: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  mkdir: async () => ({ ok: true }),
  setDirectoryPermissions: async () => ({ ok: true }),
};

const noopLog: LogApi = {
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
};

const seedHome = homePathFor(SEED_CONFIG.username);
const seedConnectivity = () => buildColdStartConnectivity('a'.repeat(64));
const seedWifi = () => generateWifi({ seedPubkeyHex: 'a'.repeat(64) });

const seedEnv = (
  userType: 'guest' | 'user' | 'root' = 'user',
  names: { readonly hostname?: string; readonly workstationName?: string } = {},
  seams: { readonly onChildCommand?: (name: string | null) => void } = {},
) =>
  buildCommandEnv({
    ...names,
    ...seams,
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
    rescanWifi: seedWifi,
    prompt: async () => '',
    onPushSession: () => undefined,
    hopChain: [],
    onPopSession: () => undefined,
    signal: new AbortController().signal,
  });

describe('the busy label a script drives', () => {
  it('passes the running child through to whoever is showing it', () => {
    const seen: (string | null)[] = [];

    const env = seedEnv('user', {}, { onChildCommand: (name) => seen.push(name) });
    env.setChildCommand('nmap');
    env.setChildCommand(null);

    expect(seen).toEqual(['nmap', null]);
  });

  it('does nothing at all when nobody is showing it', () => {
    // The label is cosmetic, so an env built without the seam must stay usable —
    // unlike `resetGame`, whose absence really is a wiring bug worth throwing on.
    expect(() => seedEnv().setChildCommand('nmap')).not.toThrow();
  });
});

describe('buildCommandEnv', () => {
  it('reads /etc/passwd at the session user tier', () => {
    const result = seedEnv('user').fs.read(asAbsPath('/etc/passwd'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a readable /etc/passwd');
    expect(result.content).toContain('alice');
  });

  it('tells where the shell stands apart from whose box it is', () => {
    // Two different questions, and a hop is where they part: after `ssh` the shell
    // stands on the remote box, while the player's own workstation keeps the name
    // their neighbours already see it under. A command that scans the player's own
    // LAN needs the second one even while standing on the first.
    const env = seedEnv('user', { hostname: 'srv-12', workstationName: 'alicebox' });

    expect(env.hostname).toBe('srv-12');
    expect(env.workstationName).toBe('alicebox');
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
    rescanWifi: seedWifi,
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

  it('yields no address from homeNetwork.join when no join seam is supplied', async () => {
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
    rescanWifi: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      hopChain: [],
      onPopSession: () => undefined,
      signal: new AbortController().signal,
    });

    // With no join seam supplied there is nobody to ISSUE an address: a player's
    // LAN address is a server-allocated lease, and a client that derived one would
    // be the second allocator the lease exists to eliminate. So the join yields
    // nothing and the connect that awaits it reports the failure.
    await expect(env.homeNetwork.join('BEAN-THERE-WIFI')).resolves.toBeNull();
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
    rescanWifi: seedWifi,
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
    rescanWifi: seedWifi,
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
    rescanWifi: seedWifi,
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
    rescanWifi: seedWifi,
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
    rescanWifi: seedWifi,
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
