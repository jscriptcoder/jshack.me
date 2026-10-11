import { readAmount } from './amount.js';
import { isAddress } from './walletKey.js';

export type MintOrder = { readonly address: string; readonly amount: number };

/** What the operator typed after the mint script's name, or `null` when it is not
 *  an order to mint: exactly an address and an amount. Nothing checks the order
 *  again before the coins exist, so nothing is repaired here: a near miss is
 *  refused. */
export const readMintOrder = (words: readonly string[]): MintOrder | null => {
  if (words.length !== 2) return null;
  const [address, amountText] = words;
  if (!isAddress(address)) return null;
  const amount = readAmount(amountText);
  return amount === null ? null : { address, amount };
};
