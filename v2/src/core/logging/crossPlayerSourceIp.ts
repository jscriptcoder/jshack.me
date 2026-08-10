/**
 * resolveCrossPlayerSourceIp — the server-authoritative source IP a cross-player
 * trace line records for its actor.
 *
 * The actor's truthful source IP is their OWN home public IP, looked up server-side
 * from their VERIFIED owner key — never a client-supplied `source_ip`, which is
 * forgeable (a client could otherwise frame another network). An actor on no home
 * network, or a lookup error, degrades to `unknown`; the action it traces stands
 * regardless.
 *
 * Shared by every cross-player trace writer — the scan `kern.log` line
 * (`resolvePublicScan`) and the ssh `auth.log` line (`authCreateSessionPublic`) —
 * so the "operating-machine IP" derivation lives in exactly one place. Today the
 * operating machine is always the actor's home box (v2 has no command-vantage
 * switch); when the pivot feature ships, only this seam changes to resolve the hop
 * they operate from, masking their real IP with no caller rework.
 *
 * Distinct from `./sourceIp` (`resolveLogSourceIP`), which is the CLIENT-side,
 * pivot-aware resolver for the future vantage switch — this is the SERVER-side
 * derivation from the verified owner key.
 *
 * Pure/framework-agnostic (core/): the network lookup is injected.
 */

export type FindHomeNetworkByOwnerKey = (
  ownerKey: string,
) => Promise<{ readonly data: { readonly public_ip: string } | null; readonly error: unknown }>;

/** One network's public address. The ESSID-keyed half of the home lookup above, asked
 *  directly — because an actor operating from a hop knows which network they are on
 *  without having to be its owner. */
export type FindPublicIpByEssid = (
  essid: string,
) => Promise<{ readonly data: { readonly public_ip: string } | null; readonly error: unknown }>;

export const resolveCrossPlayerSourceIp = async (
  findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey,
  actorKey: string,
): Promise<string> => {
  const { data, error } = await findHomeNetworkByOwnerKey(actorKey);
  return error || data === null ? 'unknown' : data.public_ip;
};

/**
 * The address a trace records for an actor, resolved from the network they are
 * OPERATING on rather than the one they own — the pivot this file's contract has
 * promised since it was written.
 *
 * `standingEssid` is the network of the box the actor holds a session on, taken from
 * the session row: it is stamped server-side when the hop is made, so it is evidence
 * rather than a client claim. Deriving it from anything the caller sends would let a
 * player assert they were standing on somebody else's LAN and write the trace up as
 * them.
 *
 * `null` means there is no session to read — the actor is on their own workstation —
 * so the network is found from their verified key, which is what every trace did
 * before pivoting existed.
 *
 * Either route degrades to `unknown` rather than guessing. A false origin in a
 * defender's log is worse than no origin, and the action being traced stands
 * regardless: a sweep is not failed over a logging detail.
 */
export const resolveVantageSourceIp = async (
  deps: {
    readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
    readonly findPublicIpByEssid: FindPublicIpByEssid;
  },
  vantage: { readonly actorKey: string; readonly standingEssid: string | null },
): Promise<string> => {
  if (vantage.standingEssid === null) {
    return resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, vantage.actorKey);
  }
  const { data, error } = await deps.findPublicIpByEssid(vantage.standingEssid);
  return error || data === null ? 'unknown' : data.public_ip;
};
