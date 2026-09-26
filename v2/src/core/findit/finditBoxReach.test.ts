import { describe, expect, it } from 'vitest';
import { resolvePublicTarget } from '../network/resolvePublicTarget';
import { handleResolvePublicScan } from '../scan/resolvePublicScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { FINDIT_HOSTNAME, FINDIT_NETWORK } from '../generation/findit';
import { computeApGatewayId } from '../identity/router';
import { CRACKABLE_PASSWORDS } from '../generation/passwordPools';
import { md5 } from '../generation/md5';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath } from '../types';

/**
 * findit is reached the way every public address is reached, so the tools a player
 * already has work on it without knowing it is special: a scan lists its doors, and a
 * login is refused the same way a login to any hardened box is. What it must NOT do is
 * pretend to be an access point: nobody can join findit's wifi, and there is no LAN
 * behind it to forward anything into.
 */

const FINDIT_PUBLIC_IP = '193.0.0.1';
const SCANNER = generateIdentity();

const deps = {
  findNetworkByPublicIp: async () => ({
    data: { router_machine_id: computeApGatewayId(FINDIT_NETWORK), essid: FINDIT_NETWORK },
    error: null,
  }),
  findPatches: async () => ({ data: [], error: null }),
  listOccupantsByEssid: async () => ({ data: [], error: null }),
  listLeasesByEssid: async () => ({ data: [], error: null }),
};

const scanDeps = {
  ...deps,
  nonceStore: async () => ({ fresh: true as const }),
  now: () => 0,
  readLog: async () => ({ data: null, error: null }),
  upsertPatch: async () => ({ error: null }),
  findHomeNetworkByOwnerKey: async () => ({ data: { public_ip: '203.0.113.9' }, error: null }),
};

describe('reaching the box findit runs on', () => {
  it('shows the two doors it keeps to anybody who scans it', async () => {
    const response = await handleResolvePublicScan(
      signRequest(SCANNER, 'resolvePublicScan', { target: FINDIT_PUBLIC_IP }),
      scanDeps,
    );

    expect(response.status).toBe(200);
    const scanned = response.body as { found: boolean; ports: readonly { port: number }[] };
    expect(scanned.found).toBe(true);
    expect(scanned.ports.map((entry) => entry.port).sort((left, right) => left - right)).toEqual([
      22, 80,
    ]);
  });

  it('answers a login attempt as itself, not as somebody’s router', async () => {
    const target = await resolvePublicTarget(deps, { publicIp: FINDIT_PUBLIC_IP, port: 22 });

    expect(target.ok).toBe(true);
    if (!target.ok) return;
    expect(target.target.hostname).toBe(FINDIT_HOSTNAME);
    // It fronts nothing: there is no network behind it to forward a port into.
    expect(target.target.frontedSegment).toBeNull();
  });

  it('holds no password any wordlist can guess', async () => {
    const target = await resolvePublicTarget(deps, { publicIp: FINDIT_PUBLIC_IP, port: 22 });
    expect(target.ok).toBe(true);
    if (!target.ok) return;

    const passwd = createFsView(target.target.fs, { userType: 'root' }).read(
      asAbsPath('/etc/passwd'),
    );
    const hashes = (passwd.ok ? passwd.content : '')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split(':')[1]);
    for (const password of CRACKABLE_PASSWORDS) {
      expect(hashes).not.toContain(md5(password));
    }
  });
});
