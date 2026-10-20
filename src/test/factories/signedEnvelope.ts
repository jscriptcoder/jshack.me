/**
 * Signed-envelope fakes — a request whose signature no longer matches what was signed.
 *
 *     handleSomething(withForgedSignature(await envelope()), deps)
 */

import type { SignedEnvelope } from '../../core/signedRequest/types.js';

/** The envelope with one bit of its signature flipped. A bit, not a byte written over
 *  it: a signature that already began with the byte written would come through
 *  untouched, and verify, one run in 256. */
export const withForgedSignature = (signed: SignedEnvelope): SignedEnvelope => {
  const flippedFirstByte = (Number.parseInt(signed.signature.slice(0, 2), 16) ^ 1)
    .toString(16)
    .padStart(2, '0');
  return { ...signed, signature: `${flippedFirstByte}${signed.signature.slice(2)}` };
};
