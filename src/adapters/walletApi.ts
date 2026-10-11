/**
 * walletApi adapter — the `/api/wallet` client behind `env.wallet`.
 *
 * `readBalance` is unsigned, unlike every request the other adapters send. The
 * ledger is public and keyed by address, so the question carries the address and
 * nothing of the player's: no identity, no session, no machine.
 *
 * `fetchImpl` is injected so tests drive the wire shape without a network.
 */

import { z } from 'zod';
import { exactCount } from '../core/wallet/exactCount.js';
import type { WalletBalanceResult } from '../core/commands/types.js';

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
