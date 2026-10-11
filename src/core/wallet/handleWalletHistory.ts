/**
 * handleWalletHistory — the public read of what one address has sent and received.
 *
 * Unsigned, as the balance read is and for the same reason: the ledger is keyed
 * by address and public, so there is nobody to authenticate.
 *
 * Only the latest few transfers are handed over, newest first, and nothing says
 * whether there were more. An address the ledger has never seen has done
 * nothing, which is an empty list and not an error.
 *
 * Which read was asked for is settled before this is called. It reads the
 * address and nothing else of the request.
 */

import { z } from 'zod';
import { exactCount } from './exactCount.js';
import type { HandlerResponse } from './handleWalletBalance.js';
import { isAddress } from './walletKey.js';

/** How many transfers a history holds. Older ones stay on the ledger, and no
 *  read shows them. */
const HISTORY_LENGTH = 20;

const address = z.string().refine(isAddress);

/** One movement of coins as the ledger tells it, on both sides of the wire. A
 *  mint has no sender. `at` is UTC and says so, so a reader can take the day and
 *  the minute straight off the text. */
export const transferRecordSchema = z.object({
  from: address.nullable(),
  to: address,
  amount: exactCount,
  at: z.iso.datetime(),
});

export type TransferRecord = z.infer<typeof transferRecordSchema>;

/** A row of the transfers table. The time must carry its offset: one that does
 *  not could be anybody's clock. */
const transferRowSchema = z.object({
  from_address: address.nullable(),
  to_address: address,
  amount: exactCount,
  created_at: z.iso.datetime({ offset: true }),
});

export type WalletHistoryDeps = {
  /** The latest `limit` transfers into or out of `address`, newest first. Typed
   *  as unknown because they are rows off the wire, parsed before they are used. */
  readonly findTransfers: (
    address: string,
    limit: number,
  ) => Promise<{
    readonly data: unknown;
    readonly error: unknown;
  }>;
};

const LOOKUP_FAILED: HandlerResponse = { status: 500, body: { error: 'history_lookup_failed' } };

const requestOf = (body: unknown): { readonly address?: unknown } =>
  typeof body === 'object' && body !== null ? body : {};

export const handleWalletHistory = async (
  body: unknown,
  deps: WalletHistoryDeps,
): Promise<HandlerResponse> => {
  const { address: named } = requestOf(body);
  if (typeof named !== 'string' || !isAddress(named)) {
    return { status: 400, body: { error: 'invalid_address' } };
  }

  const found = await deps.findTransfers(named, HISTORY_LENGTH);
  if (found.error) return LOOKUP_FAILED;

  // One row that is not a transfer spoils the list: a history with a hole in it
  // would read as a history without the transfer.
  const rows = z.array(transferRowSchema).safeParse(found.data);
  if (!rows.success) return LOOKUP_FAILED;

  const transfers: readonly TransferRecord[] = rows.data.map((row) => ({
    from: row.from_address,
    to: row.to_address,
    amount: row.amount,
    at: new Date(row.created_at).toISOString(),
  }));
  return { status: 200, body: { transfers } };
};
