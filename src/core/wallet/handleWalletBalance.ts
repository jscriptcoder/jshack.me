/**
 * handleWalletBalance — the public read of one address off the ledger.
 *
 * Unsigned, alone among the game's endpoints. The ledger is keyed by address and
 * holds nothing about players, so there is nobody to authenticate, and a signed
 * envelope would hand the server the one thing the ledger is built not to learn:
 * which player is asking about which address.
 *
 * An address the ledger has never seen holds nothing. No row is made for it and
 * no "unknown address" is answered: a wallet nobody has paid yet and a mistyped
 * address are the same thing to a ledger that keeps no list of wallets.
 */

import { z } from 'zod';
import { exactCount } from './exactCount.js';
import { isAddress } from './walletKey.js';

const balanceRowSchema = z.object({ balance: exactCount, next_sequence: exactCount });

export type WalletBalanceDeps = {
  /** The row at `address`, or `null` data when the ledger holds none. Typed as
   *  unknown because it is a row off the wire, and is parsed before it is used. */
  readonly findBalance: (address: string) => Promise<{
    readonly data: unknown;
    readonly error: unknown;
  }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const LOOKUP_FAILED: HandlerResponse = { status: 500, body: { error: 'balance_lookup_failed' } };

const requestOf = (body: unknown): { readonly action?: unknown; readonly address?: unknown } =>
  typeof body === 'object' && body !== null ? body : {};

export const handleWalletBalance = async (
  body: unknown,
  deps: WalletBalanceDeps,
): Promise<HandlerResponse> => {
  const { action, address } = requestOf(body);
  if (action !== 'balance') return { status: 400, body: { error: 'unknown_action' } };
  if (typeof address !== 'string' || !isAddress(address)) {
    return { status: 400, body: { error: 'invalid_address' } };
  }

  const found = await deps.findBalance(address);
  if (found.error) return LOOKUP_FAILED;
  if (found.data === null) return { status: 200, body: { balance: 0, nextSequence: 0 } };

  const row = balanceRowSchema.safeParse(found.data);
  if (!row.success) return LOOKUP_FAILED;
  return {
    status: 200,
    body: { balance: row.data.balance, nextSequence: row.data.next_sequence },
  };
};
