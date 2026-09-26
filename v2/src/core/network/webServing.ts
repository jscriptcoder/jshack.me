/**
 * Whether a box is actually serving the WEB on a port.
 *
 * Reaching a listening daemon is not reaching a web server: a forward onto an `sshd`,
 * or onto a gateway's own `:22`, refuses exactly like a closed port. One definition,
 * shared by the fetch that serves a page and the crawl that indexes one, so a page
 * findit lists is a page a reader can actually fetch.
 */

import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Directory } from '../filesystem/types';

export const servesWebOn = (fs: Directory, port: number): boolean =>
  readOpenPorts(fs).some(
    (openPort) => openPort.port === port && openPort.service === SERVICE_CATALOG.http.service,
  );
