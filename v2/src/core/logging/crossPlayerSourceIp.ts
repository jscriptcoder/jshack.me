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

export const resolveCrossPlayerSourceIp = async (
  findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey,
  actorKey: string,
): Promise<string> => {
  const { data, error } = await findHomeNetworkByOwnerKey(actorKey);
  return error || data === null ? 'unknown' : data.public_ip;
};
