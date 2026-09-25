/**
 * The names a gateway goes by. Kept apart from the gateway's filesystem because the
 * network's population names its gateways while a gateway's tree lists that population:
 * living in one module, each would have to import the other.
 */

import { createPrng } from './prng';

/** Router display names, ported verbatim from the legacy generator
 *  (`hostnamesByRole.router`). A router is just another machine with NAT config,
 *  so it carries a real name rather than a universal `gateway`; the cross-player
 *  scan/auth log lines read this name to identify the router. */
export const ROUTER_HOSTNAMES: readonly string[] = [
  'router01',
  'gw-main',
  'border-gw',
  'core-rtr',
  'firewall01',
  'edge-rtr',
  'fw-dmz',
  'switch-core',
  'vpn-gw',
  'net-gateway',
  'wan-rtr',
  'pfsense01',
  'opnsense',
  'mikrotik01',
  'dist-rtr',
];

/** The AP gateway's hostname, seeded from the ESSID alone (the `ap-gw-host-`
 *  namespace — SEPARATE from `ap-gw-admin-`/`ap-gw-ssh-` so the name never
 *  correlates with the secrets). Server-recoverable from the ESSID without an FS
 *  read, so a cross-player log line can name the gateway it was written on. */
export const seedApGatewayHostname = (essid: string): string =>
  createPrng(`ap-gw-host-${essid}`).pick(ROUTER_HOSTNAMES);

/** The inner gateway's hostname, seeded from the ESSID AND its LAN octet (the
 *  `inner-gw-host-` namespace — SEPARATE from the edge router's `router-host-` so a
 *  second router on the LAN draws its name independently). It reuses the router name
 *  pool because an inner gateway is still a router. ESSID-keyed like everything else
 *  about the box: an inner gateway stands on the access point's LAN, so every
 *  occupant meets the same router under the same name. */
export const seedInnerGatewayHostname = (essid: string, octet: number): string =>
  createPrng(`inner-gw-host-${essid}:${octet}`).pick(ROUTER_HOSTNAMES);
