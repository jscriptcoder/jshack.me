/**
 * Reaching a web server on the player's own LAN — the step every web tool takes
 * before it can ask for anything.
 *
 * `curl`, `gobuster` and `lynx` ask three different questions of the same door:
 * fetch this path, try these paths, render this page. Getting to the door is
 * identical for all three, and it is the step that decides WHICH TREE the request
 * reads — so a second copy drifting from this one is not untidiness, it is one
 * tool reading a machine another tool would have refused.
 *
 * It is one function rather than a handful of helpers because the ORDER is the
 * part worth protecting. A caller that resolved the host before mapping
 * `localhost` onto the address it was leased would read a different tree and key
 * its trace to a different machine — while still sharing every helper.
 *
 * Only the two failures that belong to this step live here, prefixed with the
 * program the caller names. Everything else a web tool can say — a rejected URL,
 * no network, a 404, a cross-network target it cannot serve — stays with the
 * tool, because none of it is about reaching the host.
 */

import type { CommandResult } from './types.js';
import type { Directory } from '../filesystem/types.js';
import type { OpenPort } from '../services/pidfile.js';
import type { ParsedUrl } from '../network/http.js';
import type { Vantage } from '../network/vantage.js';
import { errorLine } from './streaming.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { baseFsForLanHost } from '../generation/lanHostIdentity.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { readOpenPorts } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { resolveLanName } from '../network/resolveName.js';
import { LOOPBACK_IPV4, LOOPBACK_NAMES } from '../network/interfaces.js';

/** A server that was reached, in the terms every caller needs. */
export type ReachedHost = {
  /** The tree to read. */
  readonly fs: Directory;
  /** The network the reached box sits on — what the server keys a trace by. The one the
   *  shell stands on, which at home is the player's own WiFi. */
  readonly essid: string;
  /** The RESOLVED address, never the typed name: the server finds the machine by the
   *  address it leased, and `localhost` names no machine to anyone but us. A loopback
   *  fetch reports the loopback address, so the box logs the visit as local. */
  readonly address: string;
};

/** A finished result carrying lines — narrow enough that a caller with no terminal
 *  to print to can still read what went wrong. */
export type ErrorResult = Extract<CommandResult, { readonly kind: 'sync' }>;

/** Either the host answered, or here is the line the caller returns instead. */
export type Reach =
  | { readonly ok: true; readonly host: ReachedHost }
  | { readonly ok: false; readonly failure: ErrorResult };

const error = (message: string): ErrorResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

/** How a failed connect reads, whichever side of the network the target is on — one
 *  sentence shape, so "refused" means the same thing on the LAN and across the world. */
export const connectError = ({
  program,
  host,
  port,
  reason,
}: {
  readonly program: string;
  readonly host: string;
  readonly port: number;
  readonly reason: string;
}): ErrorResult => error(`${program}: (7) Failed to connect to ${host} port ${port}: ${reason}`);

/** The reached box's tree and the ports it is serving — the two facts the port check
 *  and the read need, found once wherever on the vantage the box turned out to be. */
type LocatedHost = {
  readonly fs: Directory;
  /** The box's open ports AS THE SHELL REACHES THEM. On a deep layer that is after the
   *  fronting gateway's ACL, so a web tool refuses exactly the port a scan showed shut. */
  readonly ports: readonly OpenPort[];
};

/**
 * The box at `address` among the networks the shell reaches, or null when none holds it.
 *
 * The shell's OWN box — reached by loopback or by its own address on the LAN it stands
 * on — reads its LIVE tree, NOT a generated one: it is the one host whose filesystem is
 * real, so pointing the generator at it would fabricate a page for a box that may
 * publish nothing, and reading the live tree is what makes a `nano` edit or a fresh
 * `mkdir` show up at once. Every other box is read as the device it is — a generated LAN
 * host, or a host on a deep layer the shell reaches — the same tree `nmap` and every
 * other door read, so a web tool never finds a server a scan showed closed, nor misses
 * one it showed open.
 */
const locateHost = ({
  root,
  vantage,
  isLoopback,
  address,
}: {
  readonly root: Directory;
  readonly vantage: Vantage;
  readonly isLoopback: boolean;
  readonly address: string;
}): LocatedHost | null => {
  if (isLoopback || (vantage.address !== null && address === vantage.address)) {
    return { fs: root, ports: readOpenPorts(root) };
  }
  // Every network the shell reaches, nearest first: the LAN it stands on, then any deep
  // layer behind a gateway it reaches. A gateway's ACL already shapes a layer's ports,
  // so the deep arm trusts `resolveDeepScanHosts` rather than re-reading the raw tree.
  for (const segment of vantage.reaches) {
    if (segment.fronting === null) {
      const host = generateHomeLan(vantage.essid).hosts.find(
        (candidate) => candidate.ip === address,
      );
      if (host !== undefined) {
        const fs = baseFsForLanHost(host, vantage.essid);
        return { fs, ports: readOpenPorts(fs) };
      }
    } else {
      const onLayer = resolveDeepScanHosts(vantage.essid, segment.fronting, root).hosts.find(
        (candidate) => candidate.host.ip === address,
      );
      if (onLayer !== undefined) {
        return { fs: onLayer.baseFs, ports: onLayer.ports };
      }
    }
  }
  return null;
};

/**
 * Resolve `url`'s host on the network the shell stands on and confirm something is
 * listening there.
 *
 * A host that exists but serves nothing refuses the connection rather than answering
 * emptily, so "unreachable" and "nothing there" stay distinguishable.
 */
export const reachWebHost = ({
  root,
  program,
  url,
  vantage,
}: {
  /** The tree the shell's OWN box holds — the one address on its network whose
   *  filesystem is real rather than generated. */
  readonly root: Directory;
  readonly program: string;
  readonly url: ParsedUrl;
  /** Where the shell stands: the network it is on, its address there, and the layers it
   *  reaches. Every tool asks this one question, so none can reach a network the shell
   *  is not standing on. */
  readonly vantage: Vantage;
}): Reach => {
  const essid = vantage.essid;
  // The names a box answers to for ITSELF resolve to the loopback address, before
  // anything else looks at the target — so the box the shell stands on serves the page,
  // and its log records a local visit, whatever the shell's own LAN address is.
  //
  // A name the network gives one of its own hosts resolves here too, through the same
  // resolver `curl` uses, so an intranet page that links `www-04.<zone>` sends the
  // browser, a followed link and a sweep to the box a curl of that name reaches.
  const isLoopback = LOOPBACK_NAMES.includes(url.host);
  const address = isLoopback ? LOOPBACK_IPV4 : (resolveLanName(essid, url.host)?.ip ?? url.host);
  const located = locateHost({ root, vantage, isLoopback, address });
  if (located === null) {
    return { ok: false, failure: error(`${program}: (6) Could not resolve host: ${url.host}`) };
  }

  const listening = located.ports.some(
    (entry) => entry.port === url.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!listening) {
    return {
      ok: false,
      failure: connectError({
        program,
        host: url.host,
        port: url.port,
        reason: 'Connection refused',
      }),
    };
  }

  return {
    ok: true,
    host: { fs: located.fs, essid, address },
  };
};
