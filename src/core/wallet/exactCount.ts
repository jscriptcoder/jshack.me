import { z } from 'zod';

/** A count of whole coins, or of transfers, small enough to cross the wire as an
 *  exact number: `int()` refuses anything past `Number.MAX_SAFE_INTEGER` as well as
 *  a fraction. The ledger holds its rows to the same bounds, so this is what
 *  refuses to repeat a count that somehow is not one, on either side of the wire. */
export const exactCount = z.number().int().min(0);
