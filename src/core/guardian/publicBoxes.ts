/**
 * The boxes the operator looks after, and how a round names them.
 *
 * Any public website can be named, by the name a player meets it under: a fixed box by
 * its key (a site's key is its domain; the boards' server has no domain, so its key is the
 * only name it has), and every other site by its network's domain, naming the box behind
 * the gateway the site is served from. A player's own box and a machine behind a gateway
 * with no site have no such name, so no round can reach them: defending those is their
 * owners' game.
 *
 * The patrol is what a round covers when it names nothing: every fixed box, then the
 * valley's civic web — each `government` and `public` network's site. Shops, cafes,
 * offices and practices stay in their owners' hands, and as neglected as that leaves them.
 */

import { FIXED_BOXES, type FixedSite } from '../generation/fixedSites.js';
import { buildFixedSiteFs } from '../generation/fixedSiteFs.js';
import { PUBLISHERS, type Publisher } from '../generation/publishers.js';
import { baseFsForLanHost } from '../generation/lanHostIdentity.js';
import { computeApGatewayId } from '../identity/router.js';
import type { Directory } from '../filesystem/types.js';
import type { NetworkCategory } from '../generation/pools/essidCatalog.js';

export type PublicBox = {
  /** What the operator calls it: the domain, or the boards' server's key. */
  readonly name: string;
  /** The network the box stands on — the key its logs and its boot marker accrete under. */
  readonly networkKey: string;
  readonly machineId: string;
  /** The box as generated, before any journal. Built on demand: a round over the patrol
   *  needs one at a time, and generating all of them up front is wasted work. */
  readonly baseFs: () => Directory;
};

const fixedBox = (site: FixedSite): PublicBox => ({
  name: site.key,
  networkKey: site.key,
  machineId: computeApGatewayId(site.key),
  baseFs: () => buildFixedSiteFs(site),
});

const siteBox = (publisher: Publisher): PublicBox => ({
  name: publisher.domain,
  networkKey: publisher.essid,
  machineId: publisher.serverId,
  baseFs: () => baseFsForLanHost(publisher.server, publisher.essid),
});

const FIXED: readonly PublicBox[] = FIXED_BOXES.map(fixedBox);

const PUBLIC_BOXES: readonly PublicBox[] = [...FIXED, ...PUBLISHERS.map(siteBox)];

/** The public website named `name`, whatever its case, or `undefined` when none is. */
export const publicBox = (name: string): PublicBox | undefined => {
  const wanted = name.toLowerCase();
  return PUBLIC_BOXES.find((box) => box.name === wanted);
};

const CIVIC: ReadonlySet<NetworkCategory> = new Set(['government', 'public']);

/** Every box a round covers when it names none, in the order it walks them. */
export const PATROL: readonly PublicBox[] = [
  ...FIXED,
  ...PUBLISHERS.filter((publisher) => CIVIC.has(publisher.category)).map(siteBox),
];
