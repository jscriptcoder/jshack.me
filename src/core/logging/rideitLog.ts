/**
 * rideit-log line formatting — the `/var/log/rideit.log` entry the ride site writes for
 * each trip a player boards:
 *
 *     2026-10-23 14:37:02 ride to Ridgemont paid at <trip address> from 203.0.113.7
 *
 * The site's own booking log, in its own words, stamped as talkit's is. `access.log` holds
 * only the `POST /board` beside the traveller's address; this line says where they went,
 * so a root on rideit.io can track travellers. The trip address is the lead beyond it: the
 * block explorer shows which wallet paid it, and each trip is paid to a fresh one. The
 * address it was sent from is the network the traveller left. Nothing tells the traveller
 * it is written.
 *
 * Every field is the server's own (a declared town, a derived address), so none needs
 * escaping.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types.js';
import type { FilePermissions } from '../filesystem/types.js';
import { formatAppLogTimestamp } from './appLogTimestamp.js';

/** The canonical `/var/log/rideit.log` storage identity. World-READABLE like the other
 *  trace files, since getting on the box is the gate; root-only WRITE, as the site's
 *  append is a system write. No boot seed: the file appears with the first ride. */
export const RIDEIT_LOG_PATH: AbsPath = asAbsPath('/var/log/rideit.log');
export const RIDEIT_LOG_OWNER = 'root';
export const RIDEIT_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

/** The line for a ride that was boarded: when, to which town, paid at which trip address,
 *  from where. */
export const formatRideitLine = (ride: {
  readonly time: GameTime;
  readonly town: string;
  readonly address: string;
  readonly sourceIp: string;
}): string =>
  `${formatAppLogTimestamp(ride.time)} ride to ${ride.town} paid at ${ride.address} from ${ride.sourceIp}`;
