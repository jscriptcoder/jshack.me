import { describe, expect, it } from 'vitest';
import {
  derivedNetworkByPublicIp,
  resolvePublicTarget,
  type ResolvePublicTargetDeps,
} from './resolvePublicTarget.js';
import { computeApGatewayId } from '../identity/router.js';
import { DECLARED_NETWORKS, publicAddress } from '../generation/world.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanHostIdentity.js';
import { databaseIn } from '../mysql/datadir.js';
import type { Directory } from '../filesystem/types.js';
import {
  DATABASE_ROUTE_ADDRESS,
  DATABASE_ROUTE_ESSID,
  DATABASE_ROUTE_KEY_BOX,
} from '../../test/factories/databaseRouteContract.js';
import {
  missionFilesWithNoPools,
  servedMissionFiles,
} from '../../test/factories/webRouteContract.js';

/**
 * A public address leads to the network that stands at that place in the world, and to
 * its gateway, which answers whether or not anybody has ever joined the network.
 */

describe('derivedNetworkByPublicIp', () => {
  it('leads the address of a network nobody has joined to its gateway', async () => {
    expect(await derivedNetworkByPublicIp(publicAddress('APT-3B-WIFI') ?? '')).toEqual({
      data: { router_machine_id: computeApGatewayId('APT-3B-WIFI'), essid: 'APT-3B-WIFI' },
      error: null,
    });
  });

  it('leads nowhere from an address no network answers at', async () => {
    expect(await derivedNetworkByPublicIp('87.1.0.1')).toEqual({ data: null, error: null });
    expect(await derivedNetworkByPublicIp('203.0.113.7')).toEqual({ data: null, error: null });
  });
});

/** A world nobody has touched: every journal empty, nobody on any network. */
const untouchedWorld: ResolvePublicTargetDeps = {
  findNetworkByPublicIp: derivedNetworkByPublicIp,
  findPatches: async () => ({ data: [], error: null }),
  listOccupantsByEssid: async () => ({ data: [], error: null }),
  listLeasesByEssid: async () => ({ data: [], error: null }),
};

describe('resolvePublicTarget', () => {
  it("reaches, through a port a Millbrook office's gateway forwards, the box behind it rather than the gateway", async () => {
    // Millbrook's logistics office, whose gateway forwards a port to a printer behind it.
    const office = DECLARED_NETWORKS.find((network) => network.key === 'r0/t1/n8');
    if (office === undefined) throw new Error('Millbrook declares no network r0/t1/n8');
    const printer = generateHomeLan(office.key).hosts.find(
      (host) => host.hostname === 'printer-57',
    );
    if (printer === undefined) throw new Error('the office keeps no printer-57');

    const result = await resolvePublicTarget(untouchedWorld, {
      publicIp: publicAddress(office.key) ?? '',
      port: 2222,
    });

    expect(result.ok && { ...result.target, fs: undefined }).toMatchObject({
      machineId: machineIdForLanHost(printer, office.key),
      hostname: 'printer-57',
      essid: office.key,
      reachedPort: 22,
    });
  });
});

describe('resolvePublicTarget through a forward onto a contract key box', () => {
  const contractWorld: ResolvePublicTargetDeps = {
    ...untouchedWorld,
    findNetworkByPublicIp: async () => ({
      data: {
        router_machine_id: computeApGatewayId(DATABASE_ROUTE_ESSID),
        essid: DATABASE_ROUTE_ESSID,
      },
      error: null,
    }),
  };

  const reach = (deps: ResolvePublicTargetDeps) =>
    resolvePublicTarget(deps, { publicIp: DATABASE_ROUTE_ADDRESS, port: 3306 });

  const tablesIn = (fs: Directory | undefined): readonly string[] =>
    fs === undefined ? [] : Object.keys(databaseIn(fs)?.tables ?? {});

  it('lays the server files on for a door that reads them', async () => {
    const result = await reach({ ...contractWorld, findMissionFiles: servedMissionFiles });

    expect(result.ok && result.target.machineId).toBe(DATABASE_ROUTE_KEY_BOX);
    expect(tablesIn(result.ok ? result.target.fs : undefined)).toContain('settings');
  });

  it('leaves the box as generated for a door that passes none', async () => {
    const result = await reach(contractWorld);

    expect(result.ok && result.target.machineId).toBe(DATABASE_ROUTE_KEY_BOX);
    expect(tablesIn(result.ok ? result.target.fs : undefined)).not.toContain('settings');
  });

  it('answers that the files cannot be made when a secret the box needs is unset', async () => {
    expect(await reach({ ...contractWorld, findMissionFiles: missionFilesWithNoPools })).toEqual({
      ok: false,
      status: 500,
      error: 'mission_secret_missing',
    });
  });

  it('still names a journal it could not read as a journal failure', async () => {
    const result = await reach({
      ...contractWorld,
      findMissionFiles: servedMissionFiles,
      findPatches: async ({ machine_id: machineId }) =>
        machineId === DATABASE_ROUTE_KEY_BOX
          ? { data: null, error: new Error('down') }
          : { data: [], error: null },
    });

    expect(result).toEqual({ ok: false, status: 500, error: 'patches_lookup_failed' });
  });
});
