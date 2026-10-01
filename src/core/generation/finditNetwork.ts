/**
 * findit.io's names, kept as a leaf so the world can refer to findit without pulling in
 * the box generator. `generation/publisher` needs these strings at module load to place
 * findit among the publishers, and the generator (`generation/findit`) pulls in the whole
 * apt/service graph, which loops back through `generateHomeLan` to `publisher` — so the
 * names living here is what keeps that from being an initialization cycle. The generator
 * re-exports them, so every existing importer is unaffected.
 */

/** The key findit is known by wherever a network is — its log rows, its address
 *  lookups. Never a wifi ESSID: nothing broadcasts it and nobody joins it. */
export const FINDIT_NETWORK = 'findit.io';

/** The name findit answers to on the web. */
export const FINDIT_DOMAIN = 'findit.io';

/** What findit calls itself on its own disk. */
export const FINDIT_HOSTNAME = 'findit';

/** The kind of place findit's box is, and what its people call it. Fixed rather than
 *  drawn, as a network outside the catalog would draw it: players reach this box, and a
 *  kind of place added to the world must not turn it into another. */
export const FINDIT_PLACE = { category: 'hacker', place: 'the workshop' } as const;
