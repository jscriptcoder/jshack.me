/**
 * The contractor boards' addresses, found where they are kept.
 *
 * Every other public address is derived from its network's place in the world, so finding
 * what stands at one reads nothing. A board's address was drawn when its handle applied and
 * stored beside the handle, so only the table knows whether one is held: held, it is the
 * boards' server, the one box every board is served from; not held, nothing is there, as at
 * any empty address, so a guess tells a prober nothing.
 *
 * Every door to a public address (a fetch, a scan, a login, a service) finds its network
 * through this one lookup, so none of them can reach a board another one cannot.
 */

import { isBoardAddress } from '../generation/ip.js';
import { BOARD_SERVER_NETWORK } from '../generation/fixedSites.js';
import { computeApGatewayId } from '../identity/router.js';
import {
  derivedNetworkByPublicIp,
  type ApNetworkLookup,
} from '../network/resolvePublicTarget.js';

/** The handle holding a board's address, or `null` where nobody holds it. */
export type FindBoardHandle = (
  address: string,
) => Promise<{ readonly data: { readonly handle: string } | null; readonly error: unknown }>;

const BOARD_SERVER: ApNetworkLookup = {
  router_machine_id: computeApGatewayId(BOARD_SERVER_NETWORK),
  essid: BOARD_SERVER_NETWORK,
};

/** The request a web server's `access.log` records for a hit on the network `essid` at
 *  `address`. Every board's address lands on the one boards' server and its one log, so
 *  there the request names the address it was asked at, in the absolute form a server logs
 *  a request that names its host: a line with the path alone would not say whose board was
 *  aimed at. Everywhere else it is the path as asked. */
export const loggedRequestPath = ({
  essid,
  address,
  path,
}: {
  readonly essid: string;
  readonly address: string;
  readonly path: string;
}): string => (essid === BOARD_SERVER_NETWORK ? `http://${address}${path}` : path);

/** The network standing at `publicIp`: the boards' server where a handle holds a board's
 *  address, otherwise whatever the world puts there. A failed read of the boards is passed
 *  on rather than answered either way. */
export const networkByPublicIp =
  (findBoardHandle: FindBoardHandle) =>
  async (
    publicIp: string,
  ): Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }> => {
    if (!isBoardAddress(publicIp)) return derivedNetworkByPublicIp(publicIp);
    const { data, error } = await findBoardHandle(publicIp);
    if (error) return { data: null, error };
    return { data: data === null ? null : BOARD_SERVER, error: null };
  };
