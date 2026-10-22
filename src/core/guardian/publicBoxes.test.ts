import { describe, expect, it } from 'vitest';
import { PATROL, publicBox } from './publicBoxes.js';
import { siteMachineIds } from '../findit/webIndex.js';
import { computeApGatewayId } from '../identity/router.js';
import { siteServer } from '../generation/siteServer.js';
import { DECLARED_NETWORKS } from '../generation/world.js';
import { FIXED_BOXES } from '../generation/fixedSites.js';
import { readDpkgStatus } from '../packages/dpkgStatus.js';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
import type { Directory } from '../filesystem/types.js';

/**
 * The boxes the operator looks after: any public website, named the way a player meets it,
 * and the patrol a round covers when no name is given — the fixed boxes and the valley's
 * civic web, leaving every shop, cafe and office to its own neglect.
 */

const read = (tree: Directory, path: string): string | null => {
  const result = createFsView(tree, { userType: 'root' }).read(asAbsPath(path));
  return result.ok ? result.content : null;
};

const networkServing = (domain: string) => {
  const network = DECLARED_NETWORKS.find((candidate) => candidate.site?.domain === domain);
  if (network === undefined) throw new Error(`no network publishes ${domain}`);
  return network;
};

describe('publicBox', () => {
  it('names the box a town site is served from, the one findit reads it on', () => {
    const network = networkServing('millbrook.gov');

    const box = publicBox('millbrook.gov');

    expect(box).toEqual(
      expect.objectContaining({ name: 'millbrook.gov', networkKey: network.key }),
    );
    expect(siteMachineIds()).toContain(box?.machineId);
    expect(box?.machineId).not.toBe(computeApGatewayId(network.key));
    expect(read(box!.baseFs(), '/etc/hostname')?.trim()).toBe(siteServer(network.key)?.hostname);
  });

  it('names a fixed site as its one box, its own gateway', () => {
    expect(publicBox('findit.io')).toEqual(
      expect.objectContaining({
        name: 'findit.io',
        networkKey: 'findit.io',
        machineId: computeApGatewayId('findit.io'),
      }),
    );
  });

  it('names the boards server, which findit lists nowhere, by its key', () => {
    expect(publicBox('boards.hireme.io')?.machineId).toBe(computeApGatewayId('boards.hireme.io'));
  });

  it("names any public website, a shop's included", () => {
    const network = networkServing('kwikemart.com');

    expect(publicBox('kwikemart.com')?.networkKey).toBe(network.key);
  });

  it('reads a name whatever its case, as a domain is', () => {
    expect(publicBox('Millbrook.GOV')?.name).toBe('millbrook.gov');
  });

  it('names nothing for a domain no public website answers to', () => {
    expect(publicBox('nowhere.example')).toBeUndefined();
    expect(publicBox('')).toBeUndefined();
  });

  it("generates the box's own tree, manifest and all", () => {
    expect(readDpkgStatus(publicBox('ashby.gov')!.baseFs())).toContain('Package: openssh-server');
    expect(readDpkgStatus(publicBox('findit.io')!.baseFs())).toContain('Package: nginx');
  });

  it('generates the same tree the server rebuilds the box from, before any journal', () => {
    const network = networkServing('ashby.gov');
    const server = siteServer(network.key)!;

    expect(publicBox('findit.io')!.baseFs()).toEqual(
      materializeApGatewayFs({ essid: 'findit.io' }, null),
    );
    expect(publicBox('ashby.gov')!.baseFs()).toEqual(
      resolveLanHostIdentity(server, network.key).baseFs,
    );
  });
});

describe('PATROL', () => {
  const civic = DECLARED_NETWORKS.filter(
    (network) => network.site !== undefined && ['government', 'public'].includes(network.category),
  ).map((network) => network.site?.domain);

  it('walks every fixed box first, in their order', () => {
    expect(PATROL.slice(0, FIXED_BOXES.length).map((box) => box.name)).toEqual(
      FIXED_BOXES.map((site) => site.key),
    );
  });

  it("then every council's, police's, court's and library's site, and the city's public ones", () => {
    const towns = PATROL.slice(FIXED_BOXES.length).map((box) => box.name);

    expect(towns).toEqual(civic);
    expect(towns).toEqual(
      expect.arrayContaining([
        'millbrook.gov',
        'millbrookpd.gov',
        'millbrooklibrary.org',
        'kingsfordcourts.gov',
        'ridgemontmetro.gov',
      ]),
    );
    expect(PATROL).toHaveLength(51);
  });

  it('leaves the shops, offices and practices to their owners', () => {
    const names = PATROL.map((box) => box.name);

    expect(names).not.toContain('kwikemart.com');
    expect(names.every((name) => publicBox(name) !== undefined)).toBe(true);
  });
});
