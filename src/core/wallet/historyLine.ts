/**
 * One transfer as an address sees it, in the words `wallet history` prints and
 * chainit.io shows, so the command and the explorer cannot word a transfer
 * differently.
 */

import type { TransferRecord } from './handleWalletHistory.js';

/** When a transfer was made, to the minute, as the wallet prints it: `2026-10-11 22:07`.
 *  The ledger's time is UTC. */
export const ledgerTime = (at: string): string => `${at.slice(0, 10)} ${at.slice(11, 16)}`;

/** One transfer as `address` sees it: coins in, with where they came from, or
 *  coins out, with where they went. Minted coins came from no address, and the
 *  word in its place is the wallet's own. The time is the ledger's, which is UTC.
 *
 *  `writeAddress` is how the reader writes the address at the other end — the
 *  explorer makes it a link to that address's page. It is never handed
 *  `coinbase`, which names no page. */
export const historyLine = (
  address: string,
  { from, to, amount, at }: TransferRecord,
  writeAddress: (other: string) => string = (other) => other,
): string => {
  const when = ledgerTime(at);
  return to === address
    ? `${when}  +${amount} JSC  from ${from === null ? 'coinbase' : writeAddress(from)}`
    : `${when}  -${amount} JSC  to ${writeAddress(to)}`;
};
