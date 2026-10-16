/**
 * chainit.io's answer to a lookup at `/address?a=…`: the ledger, read for the address
 * that was typed, as a page.
 *
 * It asks the ledger exactly what `wallet balance` and `wallet history` ask, through the
 * wallet's own handlers, so the explorer and the command hold one idea of what a row is
 * and how many transfers a history shows.
 */

import { z } from 'zod';
import { exactCount } from '../wallet/exactCount.js';
import { handleWalletBalance, type WalletBalanceDeps } from '../wallet/handleWalletBalance.js';
import {
  handleWalletHistory,
  transferRecordSchema,
  type WalletHistoryDeps,
} from '../wallet/handleWalletHistory.js';
import { isAddress } from '../wallet/walletKey.js';
import { addressPage, notAnAddressPage } from './pages.js';

/** The two reads of the public ledger a lookup makes. */
export type LedgerReads = WalletBalanceDeps & WalletHistoryDeps;

const balanceAnswer = z.object({ balance: exactCount });
const historyAnswer = z.object({ transfers: z.array(transferRecordSchema) });

/** What the reader typed into the form, spaces around it dropped. The base only lets
 *  `URL` read a path; nothing of it is used. */
const typedIn = (requestPath: string): string =>
  (new URL(requestPath, 'http://chainit.io').searchParams.get('a') ?? '').trim();

/**
 * The page for a lookup, or null when the ledger could not be read — never a page that
 * says `0 JSC` for an address nobody could read. Text that is not an address answers
 * with the form to correct it, and the ledger is not asked.
 */
export const answerAddress = async (
  requestPath: string,
  ledger: LedgerReads,
): Promise<string | null> => {
  const typed = typedIn(requestPath);
  if (!isAddress(typed)) return notAnAddressPage(typed);

  const [balance, history] = await Promise.all([
    handleWalletBalance({ action: 'balance', address: typed }, ledger),
    handleWalletHistory({ address: typed }, ledger),
  ]);
  // A read that failed answers an error, which parses as neither a balance nor a history.
  const held = balanceAnswer.safeParse(balance.body);
  const done = historyAnswer.safeParse(history.body);
  if (!held.success || !done.success) return null;
  return addressPage(typed, held.data.balance, done.data.transfers);
};
