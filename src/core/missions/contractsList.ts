/**
 * The active contracts as a root on the boards' server finds them, at `/etc/hireme/contracts`.
 *
 * SERVER ONLY by discipline, as the terms are: the file names each job's client handle, so
 * only the cross-player read the server answers imports this module.
 *
 * Beside the boards' list, one `<handle> <client handle> <mission address> <pay>` line per
 * accepted job, the pay as the bare number of JSC so every line splits into four fields. A
 * root learns every live mission and who is working it: they cannot claim another's job, but
 * they can race its contractor to the key box. The client, the address and the pay are drawn
 * from the job's number, as its briefing's are; the key is not in it, so no secret is needed.
 */

import { file, ROOT_FILE, withFiles } from '../generation/baseFs.js';
import type { Directory } from '../filesystem/types.js';
import { missionAddressForNumber } from './missionNetwork.js';
import { missionTerms } from './missionTerms.js';

/** One accepted job as the table keeps it: the handle working it, its number, and the
 *  moment it was accepted. */
export type ActiveContract = {
  readonly handle: string;
  readonly number: number;
  readonly accepted_at: string;
};

const lineOf = (contract: ActiveContract): string => {
  const address = missionAddressForNumber(contract.number);
  if (address === null) return '';
  const terms = missionTerms(contract.number);
  return `${contract.handle} ${terms.client.handle} ${address} ${terms.pay}\n`;
};

/** `box` with the active contracts laid into its `/etc/hireme`, in the order they were
 *  accepted. The list lives in the table, not in the file, so a root who rewrites the file
 *  changes what the next root reads and nobody's job. Pure: the box it is given is never
 *  changed. */
export const withContractsList = (
  box: Directory,
  contracts: readonly ActiveContract[],
): Directory => {
  const byAccepting = [...contracts].sort(
    (first, second) => Date.parse(first.accepted_at) - Date.parse(second.accepted_at),
  );
  return withFiles(box, [
    ['/etc/hireme/contracts', file(byAccepting.map(lineOf).join(''), ROOT_FILE)],
  ]);
};
