import { describe, expect, it } from 'vitest';
import { buildCommandEnv } from './env';
import { homePathFor, SEED_CONFIG, seedFs, seedSession } from './seed';
import { generateIdentity } from '../core/identity/identity';
import { asAbsPath } from '../core/types';
import { buildColdStartConnectivity, type NetworkInterface } from '../core/network/interfaces';
import { assignHomeNetwork } from '../core/network/homeNetwork';
import { generateWifi } from '../core/generation/generateWifi';
import type { PatchApi } from '../core/commands/types';

const noopPatches: PatchApi = {
  write: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  mkdir: async () => ({ ok: true }),
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
    connectivity: seedConnectivity,
    onInterfaceChange: () => undefined,
    wifiNetworks: seedWifi,
    prompt: async () => '',
    onPushSession: () => undefined,
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
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
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
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      signal: new AbortController().signal,
    });

    // The seam resolves to exactly the deterministic core derivation for this
    // identity — so a fresh connect and a reload rehydration agree on the IP.
    await expect(env.homeNetwork.join('BEAN-THERE-WIFI')).resolves.toEqual(
      assignHomeNetwork(identity.publicKeyHex, 'BEAN-THERE-WIFI'),
    );
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
      connectivity: seedConnectivity,
      onInterfaceChange: () => undefined,
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
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
      connectivity: seedConnectivity,
      onInterfaceChange: (name, iface) => calls.push([name, iface]),
      wifiNetworks: seedWifi,
      prompt: async () => '',
      onPushSession: () => undefined,
      signal: new AbortController().signal,
    });

    const wlan0 = seedConnectivity().interfaces.get('wlan0')!;
    if (wlan0.kind !== 'wireless') throw new Error('unreachable');
    env.setInterface('wlan0', { ...wlan0, monitorMode: true });

    expect(calls).toEqual([['wlan0', { ...wlan0, monitorMode: true }]]);
  });
});
