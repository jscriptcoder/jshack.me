/**
 * chainit.io's views of the whole chain: the latest transfers at `/recent` and the
 * richest addresses at `/rich`, read off the ledger for each visit.
 *
 * Nothing else in the game reads the chain this way — `wallet` only ever asks about one
 * address — so whoever watches the whole chain does it here, and leaves a line in
 * chainit's log doing it.
 */

import { z } from 'zod';
import { exactCount } from '../wallet/exactCount.js';
import { parseTransferRows } from '../wallet/handleWalletHistory.js';
import { isAddress } from '../wallet/walletKey.js';
import { recentPage, richPage } from './pages.js';

/** How many lines each view lists. Older transfers and smaller balances stay on the
 *  ledger, and no view shows them. */
const VIEW_LENGTH = 20;

/** A read off the ledger. Typed as unknown because the rows come off the wire, and are
 *  parsed before they are used. */
type LedgerRead = (limit: number) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** The two reads of the whole chain. */
export type ChainReads = {
  /** The latest `limit` transfers on the chain, newest first. */
  readonly findLatestTransfers: LedgerRead;
  /** The `limit` largest balances above zero, largest first, equal ones by address. */
  readonly findLargestBalances: LedgerRead;
};

const holdingRowSchema = z.object({
  address: z.string().refine(isAddress),
  balance: exactCount,
});

/** The latest transfers on the chain as a page, or null when the ledger could not be
 *  read or handed back a row that is not a transfer. */
export const answerRecent = async (ledger: ChainReads): Promise<string | null> => {
  const found = await ledger.findLatestTransfers(VIEW_LENGTH);
  if (found.error) return null;
  const transfers = parseTransferRows(found.data);
  return transfers === null ? null : recentPage(transfers);
};

/** The richest addresses as a page, or null when the ledger could not be read or one
 *  row is not a balance: a list with a hole in it would rank the wrong addresses. */
export const answerRich = async (ledger: ChainReads): Promise<string | null> => {
  const found = await ledger.findLargestBalances(VIEW_LENGTH);
  if (found.error) return null;
  const holdings = z.array(holdingRowSchema).safeParse(found.data);
  return holdings.success ? richPage(holdings.data) : null;
};
