/**
 * What a root finds on the two boxes whose files the server keeps in its tables.
 *
 * emailit.io keeps everybody's mail in the server's tables, not in its files, and a root
 * there is shown it at the real paths (`core/emailit/spool.ts`). The boards' server shows
 * its root the list of contractor boards the same way (`core/hireme/boards.ts`), and beside
 * it every active contract (`core/missions/contractsList.ts`).
 *
 * Every route that hands a root one of those boxes lays the view through here, before the
 * journal is replayed, so what a root wrote or removed there is what the next root sees,
 * however they got in. Below root it is never built, so no table is read: that call is the
 * caller's, because only the caller knows the tier.
 */

import { computeApGatewayId } from '../identity/router.js';
import { BOARD_SERVER_NETWORK, EMAILIT_NETWORK } from '../generation/fixedSites.js';
import { withMailSpool, type SpoolAccount } from '../emailit/spool.js';
import { withBoardsList, type Board } from '../hireme/boards.js';
import { withContractsList, type ActiveContract } from '../missions/contractsList.js';
import type { Directory } from '../filesystem/types.js';

type Lookup<Value> = { readonly data: Value | null; readonly error: unknown };

export type RootTables = {
  /** Every emailit.io account with everything in its inbox. Asked only on emailit.io's box. */
  readonly findMailSpool: () => Promise<Lookup<readonly SpoolAccount[]>>;
  /** Every contractor board, with the handle holding it. Asked only on the boards' server. */
  readonly findBoards: () => Promise<Lookup<readonly Board[]>>;
  /** Every accepted job, with the handle working it. Asked only on the boards' server. */
  readonly findContracts: () => Promise<Lookup<readonly ActiveContract[]>>;
};

/** A table that could not be read. An error, never an empty view: a root would take that for
 *  the truth. */
export type RootTableError =
  | 'mail_spool_lookup_failed'
  | 'boards_lookup_failed'
  | 'contracts_lookup_failed';

const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);
const BOARD_SERVER_MACHINE = computeApGatewayId(BOARD_SERVER_NETWORK);

/** `box` as a root on `machineId` finds it: with the mail laid in on emailit.io's box, the
 *  boards and the contracts on the boards' server, and as given on any other. */
export const withRootTableViews = async (
  tables: RootTables,
  machineId: string,
  box: Directory,
): Promise<
  | { readonly ok: true; readonly box: Directory }
  | { readonly ok: false; readonly error: RootTableError }
> => {
  if (machineId === EMAILIT_MACHINE) {
    const spool = await tables.findMailSpool();
    if (spool.error) return { ok: false, error: 'mail_spool_lookup_failed' };
    return { ok: true, box: withMailSpool(box, spool.data ?? []) };
  }
  if (machineId === BOARD_SERVER_MACHINE) {
    const boards = await tables.findBoards();
    if (boards.error) return { ok: false, error: 'boards_lookup_failed' };
    const contracts = await tables.findContracts();
    if (contracts.error) return { ok: false, error: 'contracts_lookup_failed' };
    return {
      ok: true,
      box: withContractsList(withBoardsList(box, boards.data ?? []), contracts.data ?? []),
    };
  }
  return { ok: true, box };
};
