/**
 * resolveCallerVantage — where the server places a caller, worked out from evidence it
 * holds rather than anything the caller sends.
 *
 * Every own-LAN door (`authCreateSession` and the data doors that reuse it) asks the same
 * question: which network is this caller standing on, and what address does a box on it
 * see them arrive from? The answer must not be a claim — a caller who could assert a
 * network would write their login up as someone else's, which is the whole reason the
 * address is derived here.
 *
 * Two places the caller can stand, and the function reads them in that order:
 *   - a box they NAME (`callerMachineId`): they must hold a live session there, so the
 *     network is that session row's `essid` and the address is the box's own place on its
 *     LAN — for another player's workstation, the lease its owner holds on that network,
 *     so a hop through their box is logged as them. Naming a box they do not hold is the
 *     shared L1 refusal (403). Naming their own
 *     workstation is the own-box bypass, which carries no session row and so falls through
 *     to the home reading below — the same answer by the same route, not an exception.
 *   - NO box, or their own: their own workstation, so the network is whatever their key
 *     currently occupies and the address is the lease they hold on it.
 *
 * The address is null, not an error, where the LAN cannot place the box — a host behind
 * a deeper gateway, a player's workstation whose owner has left that network, or an
 * identity holding no lease.
 * A caller genuinely on no network at all (no occupancy, no held box) has nowhere to
 * stand and is refused: the own-LAN doors have no network to regenerate for them.
 *
 * Pure/framework-agnostic (core/): every read is injected.
 */

import { lanAddressForMachineId } from '../generation/lanTopology.js';
import { leasedAddress } from '../network/lanAddress.js';
import {
  authorizeMachineAccess,
  type FindActiveSession,
} from '../patches/authorizeMachineAccess.js';

/** The caller's home network and the lease octet they hold on it, read by their verified
 *  key. `octet` is null when they occupy the network but hold no lease; the whole result
 *  is null when they occupy no network at all. */
export type HomeVantage = { readonly essid: string; readonly octet: number | null };

export type FindHomeVantage = (
  ownerKey: string,
) => Promise<{ readonly data: HomeVantage | null; readonly error: unknown }>;

/** The lease octet held on `essid` by the player whose workstation is `machineId`, read
 *  through their occupancy of that network. Null when no occupant of `essid` owns that
 *  box, or its owner holds no lease there. */
export type FindWorkstationLease = (
  essid: string,
  machineId: string,
) => Promise<{ readonly data: number | null; readonly error: unknown }>;

export type CallerVantageDeps = {
  readonly findActiveSession: FindActiveSession;
  readonly findHomeVantage: FindHomeVantage;
  readonly findWorkstationLease: FindWorkstationLease;
};

export type CallerVantage =
  | { readonly ok: true; readonly essid: string; readonly sourceIp: string | null }
  | { readonly ok: false; readonly status: number; readonly error: string };

export const resolveCallerVantage = async (
  deps: CallerVantageDeps,
  callerKey: string,
  callerMachineId: string | undefined,
): Promise<CallerVantage> => {
  if (callerMachineId !== undefined) {
    const access = await authorizeMachineAccess(callerKey, callerMachineId, deps.findActiveSession);
    if (!access.ok) {
      return { ok: false, status: access.status, error: access.error };
    }
    // A real hop: the network is the session row's, and the address is the hop box's own
    // place on that LAN. The LAN generates every NPC box's address; a player's box has
    // the lease its owner holds there instead. A box that is neither (a deep host) traces
    // as `unknown`.
    if (access.session !== null) {
      const { essid } = access.session;
      const generated = lanAddressForMachineId(essid, callerMachineId);
      if (generated !== null) return { ok: true, essid, sourceIp: generated };
      const lease = await deps.findWorkstationLease(essid, callerMachineId);
      if (lease.error) {
        return { ok: false, status: 500, error: 'vantage_lookup_failed' };
      }
      return { ok: true, essid, sourceIp: leasedAddress(essid, lease.data) };
    }
  }

  const home = await deps.findHomeVantage(callerKey);
  if (home.error) {
    return { ok: false, status: 500, error: 'vantage_lookup_failed' };
  }
  if (home.data === null) {
    return { ok: false, status: 403, error: 'caller_not_on_network' };
  }
  return {
    ok: true,
    essid: home.data.essid,
    sourceIp: leasedAddress(home.data.essid, home.data.octet),
  };
};

/**
 * The LAN boundary every own-LAN read and trace draws: a caller learns about a network
 * only by standing on it. Their vantage, as `resolveCallerVantage` places them, when it
 * is on `essid`; otherwise the same refusal whichever door they knocked on, so no door
 * can answer for a network the caller merely names.
 */
export const resolveCallerVantageOn = async (
  deps: CallerVantageDeps,
  callerKey: string,
  callerMachineId: string | undefined,
  essid: string,
): Promise<CallerVantage> => {
  const vantage = await resolveCallerVantage(deps, callerKey, callerMachineId);
  if (vantage.ok && vantage.essid !== essid) {
    return { ok: false, status: 403, error: 'wrong_network' };
  }
  return vantage;
};
