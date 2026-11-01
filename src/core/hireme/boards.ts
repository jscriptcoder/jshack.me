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
 *
 * A root on the boards' server is shown the same table as a file, every handle beside its
 * address, at `/etc/hireme/boards`.
 */

import { isBoardAddress, isMissionAddress } from '../generation/ip.js';
import { BOARD_SERVER_NETWORK } from '../generation/fixedSites.js';
import { computeApGatewayId } from '../identity/router.js';
import { file, ROOT_FILE, withFiles } from '../generation/baseFs.js';
import { missionEssid, missionNumberForAddress } from '../missions/missionNetwork.js';
import type { Directory } from '../filesystem/types.js';
import {
  derivedNetworkByPublicIp,
  type ApNetworkLookup,
} from '../network/resolvePublicTarget.js';

/** The handle holding a board's address, or `null` where nobody holds it. */
export type FindBoardHandle = (
  address: string,
) => Promise<{ readonly data: { readonly handle: string } | null; readonly error: unknown }>;

/** The recorded state of the contract numbered `missionNumber`, or `null` where no row
 *  names it. Only the table knows whether a number was ever drawn and how far its job got;
 *  the number's network stands at its 195 address only once the state is a reachable one. */
export type FindMissionState = (
  missionNumber: number,
) => Promise<{ readonly data: { readonly state: string } | null; readonly error: unknown }>;

/** The states in which a contract's network answers at its address: once a contractor has
 *  accepted it, and for good after the job completes or is abandoned (the network is
 *  persistent and shared, and its address may already be out). An `offered` or `burned`
 *  number is never reachable — the server drew it, but nobody was ever hired for it. */
const REACHABLE_MISSION_STATES: ReadonlySet<string> = new Set(['accepted', 'completed', 'abandoned']);

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

/** One board as the table keeps it: the handle holding it, its address, and the moment the
 *  handle first applied. */
export type Board = {
  readonly handle: string;
  readonly address: string;
  readonly applied_at: string;
};

/** `box` with the list of boards laid into its `/etc/hireme`: one `<handle> <address>` line
 *  per board, in the order they were applied for. The list lives in the table, not in the
 *  file, so a root who rewrites the file changes what the next root reads and nobody's board.
 *  Pure: the box it is given is never changed. */
export const withBoardsList = (box: Directory, boards: readonly Board[]): Directory => {
  const byApplying = [...boards].sort(
    (first, second) => Date.parse(first.applied_at) - Date.parse(second.applied_at),
  );
  return withFiles(box, [
    [
      '/etc/hireme/boards',
      file(byApplying.map((held) => `${held.handle} ${held.address}\n`).join(''), ROOT_FILE),
    ],
  ]);
};

/** The network standing at `publicIp`: the boards' server where a handle holds a board's
 *  address, a contract's network where its 195 number has been accepted (or since
 *  completed or abandoned), otherwise whatever the world puts there. A board address is
 *  looked up only against the boards, a 195 address only against the missions table, and
 *  every other address against the world alone; a failed read of either table is passed on
 *  rather than answered either way. */
export const networkByPublicIp =
  ({
    findBoardHandle,
    findMissionState,
  }: {
    readonly findBoardHandle: FindBoardHandle;
    readonly findMissionState: FindMissionState;
  }) =>
  async (
    publicIp: string,
  ): Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }> => {
    if (isMissionAddress(publicIp)) {
      // A 195 address whose last octet is not a host octet names no contract, so no row
      // could ever stand at it: it answers as an empty address without the table being read.
      const missionNumber = missionNumberForAddress(publicIp);
      if (missionNumber === null) return { data: null, error: null };
      const { data, error } = await findMissionState(missionNumber);
      if (error) return { data: null, error };
      if (data === null || !REACHABLE_MISSION_STATES.has(data.state)) {
        return { data: null, error: null };
      }
      const essid = missionEssid(missionNumber);
      return { data: { router_machine_id: computeApGatewayId(essid), essid }, error: null };
    }
    if (!isBoardAddress(publicIp)) return derivedNetworkByPublicIp(publicIp);
    const { data, error } = await findBoardHandle(publicIp);
    if (error) return { data: null, error };
    return { data: data === null ? null : BOARD_SERVER, error: null };
  };
