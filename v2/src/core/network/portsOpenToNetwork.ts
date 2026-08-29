/**
 * What a box answers to the NETWORK — everything listening on it, less whatever its own
 * `rules.v4` filter refuses.
 *
 * A VIEW over `readOpenPorts`, never a replacement for it. The pidfiles stay the truth
 * about what is running, because a filtered daemon IS running: that is the whole reason
 * to prefer a filter to `systemctl stop`, which closes the service to its owner too. So
 * `ps` and the owner's own scan keep reading the pidfiles directly, and only the paths a
 * REMOTE caller arrives on read this.
 *
 * Which makes the choice of call site the entire security boundary. Every vantage that
 * resolves somebody else's box — the shared service reach, the occupant and public
 * scans, ssh, and the sweeps — asks here; the own-box path never reaches the server at
 * all, which is what makes "closed to the network, open on localhost" true by
 * construction rather than by a rule someone has to remember.
 *
 * A box with no filter file is a box with no filter, never a box with no ports: every
 * generated machine in the world, and every player's until they install one.
 */

import { parseInputDenies, readRulesV4 } from './iptablesRules';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import type { Directory } from '../filesystem/types';

export const portsOpenToNetwork = (hostFs: Directory): readonly OpenPort[] => {
  const denied = new Set(parseInputDenies(readRulesV4(hostFs)));
  return readOpenPorts(hostFs).filter((open) => !denied.has(open.port));
};
