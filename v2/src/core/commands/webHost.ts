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

import type { CommandEnv, CommandResult } from './types';
import type { Directory } from '../filesystem/types';
import type { ParsedUrl } from '../network/http';
import { errorLine } from './streaming';
import { generateHomeLan } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { LOOPBACK_IPV4, type ConnectedWlan0 } from '../network/interfaces';

/** The names a box answers to for ITSELF. A player testing their own web server types
 *  `localhost` long before they type the address they were leased, and every real box
 *  answers to both — so a failure here would read as a broken server rather than a
 *  missing alias. The address comes from `interfaces`, which already owns it. */
const LOOPBACK_NAMES: readonly string[] = ['localhost', LOOPBACK_IPV4];

/** A server that was reached, in the terms every caller needs. */
export type ReachedHost = {
  /** The tree to read. */
  readonly fs: Directory;
  /** The LAN it sits on — what the server keys a trace by, alongside the address. */
  readonly essid: string;
  /** The RESOLVED address, never the typed name: the server finds the machine by the
   *  address it leased, and `localhost` names no machine to anyone but us. */
  readonly address: string;
  /** Where the request appears to come from. A request that arrived over loopback says
   *  so, as a real server's log does — the box is both ends of it. */
  readonly sourceIp: string;
};

/** Either the host answered, or here is the line the caller returns instead. */
export type Reach =
  | { readonly ok: true; readonly host: ReachedHost }
  | { readonly ok: false; readonly failure: CommandResult };

const error = (message: string): CommandResult => ({
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
}): CommandResult => error(`${program}: (7) Failed to connect to ${host} port ${port}: ${reason}`);

/**
 * The filesystem behind `target`, or null when nothing on the LAN answers to that
 * address.
 *
 * The player's own address resolves to their LIVE tree, NOT to a generated one:
 * their box is the only host on the network whose filesystem is real, so pointing
 * the host generator at their own IP would fabricate an NPC page for a box that may
 * publish nothing at all. Reading the live tree is also what makes an edit visible
 * — `nano` on the page changes what a fetch returns, and a directory just made with
 * `mkdir` is sweepable immediately, because it is the same tree.
 *
 * Everything downstream is identical for both: a generated host's tree and the
 * player's own are both just trees, so the port check, the web-root confinement,
 * and the read all stay in one place.
 */
const targetFs = ({
  env,
  essid,
  ownIp,
  target,
}: {
  readonly env: CommandEnv;
  readonly essid: string;
  readonly ownIp: string;
  readonly target: string;
}): Directory | null => {
  if (target === ownIp) return env.fs.root();
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  return host === undefined ? null : buildRemoteHostFs(essid, host);
};

/**
 * Resolve `url`'s host on the player's LAN and confirm something is listening there.
 *
 * A host that exists but serves nothing refuses the connection rather than answering
 * emptily, so "unreachable" and "nothing there" stay distinguishable.
 */
export const reachWebHost = ({
  env,
  program,
  url,
  wlan0,
}: {
  readonly env: CommandEnv;
  readonly program: string;
  readonly url: ParsedUrl;
  readonly wlan0: ConnectedWlan0;
}): Reach => {
  const essid = wlan0.association.essid;
  // The names a box answers to for ITSELF all resolve to the ONE address it was
  // leased, before anything else looks at the target. That keeps the tree, the port
  // check, and the trace the server writes talking about one machine under one name —
  // `localhost` cannot end up disagreeing with the LAN address about the same box.
  const isLoopback = LOOPBACK_NAMES.includes(url.host);
  const address = isLoopback ? wlan0.ipv4 : url.host;
  const fs = targetFs({ env, essid, ownIp: wlan0.ipv4, target: address });
  if (fs === null) {
    return { ok: false, failure: error(`${program}: (6) Could not resolve host: ${url.host}`) };
  }

  const listening = readOpenPorts(fs).some(
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
    host: { fs, essid, address, sourceIp: isLoopback ? LOOPBACK_IPV4 : wlan0.ipv4 },
  };
};
