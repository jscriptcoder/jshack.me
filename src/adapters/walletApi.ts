/**
 * walletApi adapter — the `/api/wallet` client behind `env.wallet`.
 *
 * `readBalance` is unsigned, unlike every request the other adapters send. The
 * ledger is public and keyed by address, so the question carries the address and
 * nothing of the player's: no identity, no session, no machine.
 *
 * `sendTransfer` is signed, in the envelope every other adapter uses, but by the
 * wallet's key. The player's identity signs nothing here, so the ledger never
 * learns who moved the coins.
 *
 * `fetchImpl` is injected so tests drive the wire shape without a network.
 */

import { z } from 'zod';
import { signRequest } from '../core/signedRequest/sign.js';
import { exactCount } from '../core/wallet/exactCount.js';
import { TRANSFER_REFUSALS } from '../core/wallet/handleWalletTransfer.js';
import { signerOf } from '../core/wallet/walletKey.js';
import type {
  WalletBalanceResult,
  WalletTransferOrder,
  WalletTransferResult,
} from '../core/commands/types.js';

const DEFAULT_ENDPOINT = '/api/wallet';

export type WalletClientDeps = {
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
};

const balanceAnswerSchema = z.object({ balance: exactCount, nextSequence: exactCount });

/** Every way of not getting a balance is one answer to the command: the ledger
 *  did not answer. A status that is not ok is never read for one, so an error
 *  that happens to carry a number is not repeated to the player as coins. */
const NO_ANSWER: WalletBalanceResult = { ok: false, error: 'network_error' };

export const readBalance = async (
  deps: WalletClientDeps,
  address: string,
): Promise<WalletBalanceResult> => {
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const response = await doFetch(deps.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'balance', address }),
    });
    if (!response.ok) return NO_ANSWER;
    const answer = balanceAnswerSchema.safeParse(await response.json());
    return answer.success ? { ok: true, ...answer.data } : NO_ANSWER;
  } catch {
    return NO_ANSWER;
  }
};

const madeSchema = z.object({ ok: z.literal(true) });
const refusedSchema = z.object({ error: z.enum(TRANSFER_REFUSALS) });

/** A transfer that got no answer worth believing. The coins may have moved or
 *  not, and the command is not told which, because nothing here knows. */
const NOT_ANSWERED: WalletTransferResult = { ok: false, error: 'network_error' };

export const sendTransfer = async (
  deps: WalletClientDeps,
  { keyHex, to, amount, sequence }: WalletTransferOrder,
): Promise<WalletTransferResult> => {
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const response = await doFetch(deps.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signRequest(signerOf(keyHex), 'transfer', { to, amount, sequence })),
    });
    const answer: unknown = await response.json();
    // Only an ok status is read for a transfer made, and only a failed one for a
    // refusal: an error that happens to say `ok` moved nothing.
    if (response.ok) return madeSchema.safeParse(answer).success ? { ok: true } : NOT_ANSWERED;
    const refused = refusedSchema.safeParse(answer);
    return refused.success ? { ok: false, error: refused.data.error } : NOT_ANSWERED;
  } catch {
    return NOT_ANSWERED;
  }
};
