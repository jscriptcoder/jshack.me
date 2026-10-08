/**
 * Whether a box is actually serving the WEB on a port.
 *
 * Reaching a listening daemon is not reaching a web server: a forward onto an `sshd`,
 * or onto a gateway's own `:22`, refuses exactly like a closed port. One definition,
 * shared by the fetch that serves a page and the crawl that indexes one, so a page
 * findit lists is a page a reader can actually fetch.
 */

import { serviceRunningOn } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import type { Directory } from '../filesystem/types.js';

/** Which program serves the web on a port of this box (`nginx`, `apache2`), or
 *  undefined when none does — what a response's `Server` header names. */
export const webProgramOn = (fs: Directory, port: number): string | undefined => {
  const running = serviceRunningOn(fs, port);
  return running?.spec === SERVICE_CATALOG.http ? running.program : undefined;
};

export const servesWebOn = (fs: Directory, port: number): boolean =>
  webProgramOn(fs, port) !== undefined;
