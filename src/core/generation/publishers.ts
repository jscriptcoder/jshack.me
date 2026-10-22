/**
 * Every network that publishes a website, with the two machines a visit to it passes
 * through: its gateway, and the box behind it the site is served from.
 *
 * One derivation for everything that names a site's box — findit's index reads these
 * machines, and the operator's guardian patches and restores them — so the two cannot
 * disagree about which box a domain lives on.
 */

import { DECLARED_NETWORKS } from './world.js';
import { siteServer } from './siteServer.js';
import { resolveLanHostIdentity } from './lanHostIdentity.js';
import { computeApGatewayId } from '../identity/router.js';
import type { LanHost } from './generateHomeLan.js';
import type { NetworkCategory } from './pools/essidCatalog.js';

/** An institution that publishes, with the two machines a visit to it passes through. */
export type Publisher = {
  readonly essid: string;
  readonly domain: string;
  readonly category: NetworkCategory;
  readonly gatewayId: string;
  /** The machine the institution serves its site from — kept whole, because the box it
   *  rebuilds into is seeded from its name as well as its address. */
  readonly server: LanHost;
  readonly serverId: string;
};

export const PUBLISHERS: readonly Publisher[] = DECLARED_NETWORKS.flatMap((network) => {
  const server = network.site === undefined ? undefined : siteServer(network.key);
  if (network.site === undefined || server === undefined) return [];
  return [
    {
      essid: network.key,
      domain: network.site.domain,
      category: network.category,
      gatewayId: computeApGatewayId(network.key),
      server,
      serverId: resolveLanHostIdentity(server, network.key).machineId,
    },
  ];
});
