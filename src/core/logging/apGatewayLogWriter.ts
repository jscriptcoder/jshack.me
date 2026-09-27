/**
 * Whose journal row the logs of an OWNERLESS box on a network accrete under — the AP
 * gateway's `kern.log` for a public scan and `auth.log` for a login on the port it serves
 * itself, and the same for the inner gateways and the generated machines behind them.
 *
 * Nobody owns these boxes: they belong to the access point, not to any player, so there
 * is no owner key to file them under. But `patches` rows are keyed
 * `(machine_id, path, writer_key)` and a log patch carries the WHOLE file, so on replay
 * the newest row for a path wins outright. Split one log across two writer keys and the
 * later row silently erases the earlier one's lines. The key therefore has to be STABLE,
 * not merely present.
 *
 * So the network writes as itself: a key derived from the ESSID alone. It is there before
 * anybody has ever joined — an institution's website logs its first visitor — and it does
 * not move as players join, leave, or rejoin. It is a system key, not a player's: the
 * `ap:` prefix keeps it from ever reading as a 64-hex pubkey. Who acted lives in the line
 * itself, never in the row it lands in.
 */

export const apGatewayLogWriterKey = (essid: string): string => `ap:${essid}`;
