/**
 * The box an institution serves its website from.
 *
 * Every publisher's LAN holds at least one machine named for the webserver role, and
 * the lowest-addressed of them is the one its gateway sends the public web to. Derived
 * from the ESSID alone, like the LAN itself, so the gateway, the box and the server
 * all agree on which machine the site lives on.
 */

import { generateHomeLan, type LanHost } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { publisherSite } from './publisher';

/** The machine `essid`'s website is served from, or `undefined` for a network that
 *  publishes none. */
export const siteServer = (essid: string): LanHost | undefined =>
  publisherSite(essid) === undefined
    ? undefined
    : generateHomeLan(essid).hosts.find(
        (host) => host.kind === 'machine' && roleOfHostname(host.hostname) === 'webserver',
      );

/** Whether `host` is the machine `essid`'s website is served from. The address alone
 *  decides it: no deeper layer shares the home LAN's subnet. */
export const isSiteServer = (essid: string, host: LanHost): boolean =>
  siteServer(essid)?.ip === host.ip;
