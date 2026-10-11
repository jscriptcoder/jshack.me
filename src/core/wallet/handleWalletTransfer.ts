/**
 * handleWalletTransfer — coins leaving one address for another.
 *
 * The envelope is the one every signed action uses, but the key that signs it is
 * the wallet's, not the player's. The sending address is worked out from that
 * key and is never read off the payload, so holding the key is the whole of
 * being allowed to spend: no machine, session or player is asked about.
 *
 * What can be decided from the request alone is decided here. What depends on
 * the ledger's rows (the sequence number is the wallet's next one, the balance
 * covers the amount, the destination has room) is the ledger's to decide, in the
 * one transaction that moves the coins, and comes back as a word.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { exactCount } from './exactCount.js';
import { addressOfPublicKey, isAddress } from './walletKey.js';

/** Why the ledger left the coins where they were. */
export const TRANSFER_REFUSALS = [
  'stale_sequence',
  'insufficient_balance',
  'destination_full',
] as const;
export type TransferRefusal = (typeof TRANSFER_REFUSALS)[number];

export type TransferOrder = {
  readonly from: string;
  readonly to: string;
  readonly amount: number;
  /** The sequence number the sender read off the ledger. The ledger moves the
   *  coins only while it is still the wallet's next one, which is what stops a
   *  captured transfer from being sent a second time. */
  readonly sequence: number;
};

export type WalletTransferDeps = {
  readonly nonceStore: NonceStore;
  readonly now?: () => number;
  /** The ledger's answer: `moved`, or one of the refusals. Typed as unknown
   *  because it comes off the wire, and is parsed before it is believed. */
  readonly transfer: (order: TransferOrder) => Promise<{
    readonly data: unknown;
    readonly error: unknown;
  }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const transferSchema = z.looseObject({
  action: z.literal('transfer'),
  to: z.string().refine(isAddress),
  amount: exactCount.min(1),
  sequence: exactCount,
});

const outcomeSchema = z.enum(['moved', ...TRANSFER_REFUSALS]);

const TRANSFER_FAILED: HandlerResponse = { status: 500, body: { error: 'transfer_failed' } };

export const handleWalletTransfer = async (
  body: unknown,
  deps: WalletTransferDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, transferSchema, deps);
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const from = addressOfPublicKey(verified.publicKey);
  const { to, amount, sequence } = verified.payload;
  if (to === from) return { status: 400, body: { error: 'self_transfer' } };

  const made = await deps.transfer({ from, to, amount, sequence });
  if (made.error) return TRANSFER_FAILED;
  const outcome = outcomeSchema.safeParse(made.data);
  if (!outcome.success) return TRANSFER_FAILED;
  if (outcome.data !== 'moved') return { status: 409, body: { error: outcome.data } };
  return { status: 200, body: { ok: true } };
};
