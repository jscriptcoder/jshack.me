/**
 * The institutions that publish a website to the whole world.
 *
 * An office, a café, the university and the city's public places each put a site on
 * the internet. Which network publishes, and under what domain, is catalog data, so
 * the public web is the same for every player without anything being stored.
 */

import type { PublishedSite } from './pools/essidCatalog.js';
import { FIXED_SITES } from './fixedSites.js';
import { DECLARED_NETWORKS, publicAddress } from './world.js';

const SITE_BY_ESSID: ReadonlyMap<string, PublishedSite> = new Map(
  DECLARED_NETWORKS.flatMap((network) =>
    network.site === undefined ? [] : [[network.key, network.site]],
  ),
);

/** The website `essid` publishes, or `undefined` for a network that publishes none. */
export const publisherSite = (essid: string): PublishedSite | undefined => SITE_BY_ESSID.get(essid);

/** Where `essid`'s website answers on the internet, or `undefined` for a network that
 *  publishes none. The address is the network's own, derived from its place in the
 *  world, so it exists before anybody has joined the network. */
export const publisherIp = (essid: string): string | undefined =>
  SITE_BY_ESSID.has(essid) ? publicAddress(essid) : undefined;

const NETWORK_BY_DOMAIN: ReadonlyMap<string, string> = new Map([
  ...[...SITE_BY_ESSID].map(([essid, site]): [string, string] => [site.domain, essid]),
  ...FIXED_SITES.map((site): [string, string] => [site.domain, site.key]),
]);

/** The address the website called `domain` answers at, or `undefined` when nobody
 *  holds that domain. This is the world's whole DNS: every published name is declared,
 *  so every player's resolver gives the same answer. */
export const siteAddress = (domain: string): string | undefined => {
  const essid = NETWORK_BY_DOMAIN.get(domain);
  return essid === undefined ? undefined : publicAddress(essid);
};
