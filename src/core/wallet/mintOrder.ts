import { isAddress } from './walletKey.js';

export type MintOrder = { readonly address: string; readonly amount: number };

/** A count of coins as it is typed: digits only, never starting with a zero, so
 *  there is one way to write each amount and no sign, fraction or exponent. */
const AMOUNT = /^[1-9][0-9]*$/;

/** What the operator typed after the mint script's name, or `null` when it is not
 *  an order to mint: exactly an address and an amount, the amount no larger than
 *  the ledger can hold as an exact number. Nothing checks the order again before
 *  the coins exist, so nothing is repaired here: a near miss is refused. */
export const readMintOrder = (words: readonly string[]): MintOrder | null => {
  if (words.length !== 2) return null;
  const [address, amountText] = words;
  if (!isAddress(address) || !AMOUNT.test(amountText)) return null;
  const amount = Number(amountText);
  return Number.isSafeInteger(amount) ? { address, amount } : null;
};
