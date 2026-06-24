import { describe, expect, it } from 'vitest';
import { scanResult } from './scanResult';
import { buildDeepLayerPortResolver } from './deepLayerPortResolver';
import { generateDeepLayer } from '../generation/generateDeepLayer';
import { buildInnerGatewayBaseFs } from '../generation/routerFs';
import { computeInnerGatewayId } from '../identity/router';
import { applyPatches } from '../filesystem/applyPatches';
import type { Directory } from '../filesystem/types';

/**
 * `buildDeepLayerPortResolver` is the `resolveTargetPorts` the single `scanResult`
 * total function injects when it scans an inner gateway from OUTSIDE (the upstream
 * `external` vantage): it answers "what ports is the host behind this NAT forward
 * serving?" for the one deep-layer machine. Composed with `scanResult`, it is the
 * liveness gate a forward passes only while its deep target is actually up — so a
 * `forward 2222 to <deep host>:22` surfaces `:2222`, but a forward to a dead
 * address or a port the deep host doesn't serve stays hidden.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const GATEWAY_OCTET = 37;

// The deep layer is keyed by the gateway that fronts it; the resolver and the deep
// layer it gates over share the SAME fronting gateway so their addresses agree.
const FRONTING = { machineId: computeInnerGatewayId(PUBKEY, GATEWAY_OCTET), kind: 'router' } as const;
const deep = generateDeepLayer(PUBKEY, ESSID, FRONTING);
const resolver = buildDeepLayerPortResolver({
  seedPubkeyHex: PUBKEY,
  essid: ESSID,
  frontingGateway: FRONTING,
});

const RULES_V4_PERMS = { read: ['root'], write: ['root'], execute: [] } as const;

/** The inner gateway's FS carrying a single `rules.v4` forward line. */
const innerGatewayForwarding = (rule: string): Directory =>
  applyPatches(buildInnerGatewayBaseFs(PUBKEY, GATEWAY_OCTET), [
    { path: '/etc/iptables/rules.v4', content: `${rule}\n`, owner: 'root', permissions: RULES_V4_PERMS },
  ]);

const externalScan = (routerFs: Directory) =>
  scanResult({ vantage: 'external', routerFs, resolveTargetPorts: resolver });

describe('buildDeepLayerPortResolver (composed with scanResult)', () => {
  it('surfaces the forwarded port when the forward targets the live deep host', () => {
    const ports = externalScan(innerGatewayForwarding(`forward 2222 to ${deep.host.ip}:22`));

    expect(ports.some((openPort) => openPort.port === 2222 && openPort.service === 'ssh')).toBe(true);
    // The gateway's own sshd is still exposed alongside the forward.
    expect(ports.some((openPort) => openPort.port === 22)).toBe(true);
  });

  it('hides the forward when it targets an address with no deep host', () => {
    const ports = externalScan(innerGatewayForwarding('forward 2222 to 10.9.9.9:22'));

    expect(ports.some((openPort) => openPort.port === 2222)).toBe(false);
  });

  it('hides the forward when the deep host does not serve the internal port', () => {
    const ports = externalScan(innerGatewayForwarding(`forward 2222 to ${deep.host.ip}:9999`));

    expect(ports.some((openPort) => openPort.port === 2222)).toBe(false);
  });
});

describe('buildDeepLayerPortResolver (unit)', () => {
  it('returns the deep host ports only for the deep host address, nothing elsewhere', () => {
    expect(resolver(deep.host.ip).some((openPort) => openPort.port === 22)).toBe(true);
    expect(resolver('10.9.9.9')).toEqual([]);
  });
});
