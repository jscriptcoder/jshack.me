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
 *     LAN. Naming a box they do not hold is the shared L1 refusal (403). Naming their own
 *     workstation is the own-box bypass, which carries no session row and so falls through
 *     to the home reading below — the same answer by the same route, not an exception.
 *   - NO box, or their own: their own workstation, so the network is whatever their key
 *     currently occupies and the address is the lease they hold on it.
 *
 * The address is null, not an error, where the LAN cannot place the box — another
 * player's workstation, a host behind a deeper gateway, or an identity holding no lease.
 * A caller genuinely on no network at all (no occupancy, no held box) has nowhere to
 * stand and is refused: the own-LAN doors have no network to regenerate for them.
 *
 * Pure/framework-agnostic (core/): both reads are injected.
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

export type CallerVantageDeps = {
  readonly findActiveSession: FindActiveSession;
  readonly findHomeVantage: FindHomeVantage;
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
    // place on that LAN — null for a box the LAN does not generate (a player's, a deep
    // host's), which traces as `unknown`.
    if (access.session !== null) {
      return {
        ok: true,
        essid: access.session.essid,
        sourceIp: lanAddressForMachineId(access.session.essid, callerMachineId),
      };
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
