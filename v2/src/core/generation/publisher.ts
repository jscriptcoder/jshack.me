/**
 * The institutions that publish a website to the whole world.
 *
 * An office, a café, the university and the city's public places each put a site on
 * the internet. Which network publishes, and under what domain, is catalog data, so
 * the public web is the same for every player without anything being stored.
 */

import { PUBLISHER_FIRST_OCTET } from './ip';
import { ESSID_CATALOG, type PublishedSite } from './pools/essidCatalog';
import { createPrng } from './prng';

const SITE_BY_ESSID: ReadonlyMap<string, PublishedSite> = new Map(
  ESSID_CATALOG.flatMap((entry) => (entry.site === undefined ? [] : [[entry.essid, entry.site]])),
);

/** The website `essid` publishes, or `undefined` for a network that publishes none. */
export const publisherSite = (essid: string): PublishedSite | undefined => SITE_BY_ESSID.get(essid);

const derivedIp = (essid: string): string => {
  const prng = createPrng(`publisher-ip-${essid}`);
  return `${PUBLISHER_FIRST_OCTET}.${prng.nextInt(1, 254)}.${prng.nextInt(1, 254)}.${prng.nextInt(2, 254)}`;
};

/** Where `essid`'s website answers on the internet, or `undefined` for a network that
 *  publishes none. The address is derived rather than allocated, so it exists before
 *  anybody has joined the network, and its first octet is one no joining network draws,
 *  so a player's own address can never land on it. */
export const publisherIp = (essid: string): string | undefined =>
  SITE_BY_ESSID.has(essid) ? derivedIp(essid) : undefined;

const PUBLISHER_BY_IP: ReadonlyMap<string, string> = new Map(
  [...SITE_BY_ESSID.keys()].map((essid) => [derivedIp(essid), essid]),
);

/** The institution whose website answers at `ip`, or `undefined` when none does. The
 *  server asks this when no joined network holds an address, so a site is on the
 *  internet before anybody has ever stood on its wifi. */
export const publisherAt = (ip: string): string | undefined => PUBLISHER_BY_IP.get(ip);
