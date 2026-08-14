/**
 * gobuster — walk a list of paths against a web server and report what answers.
 *
 * The recon `curl` cannot do. `curl` fetches a path the player already knows, so
 * it can only ever confirm what a page told them; this asks about paths nobody
 * advertised. What comes back is the difference between a server's public face and
 * what it actually holds.
 *
 * The gate is the credential layer's rule moved to a different domain: a path is
 * found IF AND ONLY IF it is a word in the file AND something is served there. A
 * page sitting in the document root that no word names stays hidden however
 * readable it is, and a word naming nothing is not reported. So the list is the
 * progression — the player grows it by hand, the same way they grow the password
 * wordlist, and the tool reads the FILE rather than the shipped constant.
 *
 * Reading and probing both happen where the player STANDS: the list comes off the
 * current machine, so a sweep works from a box they have taken exactly as it does
 * at home. It reaches hosts on that machine's own LAN, and resolves them through
 * the same pieces `curl` does — one parser, one document-root confinement, one port
 * check — because two readings of a URL would mean a path reachable through one
 * tool and refused by the other.
 *
 * Every miss is silent HERE and loud on the target: the attacker's screen shows
 * only what answered, while the box records each probe it was asked about. That
 * asymmetry is the point of the tool and the whole cost of using it.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import type { Directory } from '../filesystem/types';
import { streamedResult, text } from './streaming';
import { parseHttpUrl } from '../network/http';
import { sweepWord, type ProbedPath } from '../network/webSweep';
import { DIRLIST_PATH, parseDirlist } from '../network/defaultDirlist';
import { isPublicIp } from '../generation/ip';
import { connectedWlan0 } from '../network/interfaces';
import { connectError, reachWebHost } from './webHost';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const USAGE = 'gobuster: usage: gobuster <url> (e.g. gobuster http://192.168.1.5)';

const UNREACHABLE = 'gobuster: (7) Failed to connect — network is unreachable';

/** Without a list there is nothing to try, and reporting "0 found" would read as a
 *  server with nothing on it rather than as a tool with nothing to ask. The same
 *  sentence wherever the list was read from — here or on the far side. */
const NO_LIST = `gobuster: no wordlist at ${DIRLIST_PATH} — install one with: apt install gobuster`;

/** Beat between probes. Short, because a sweep is many requests rather than a few
 *  slow ones, and a list of forty should not take a minute to walk. */
const PROBE_DELAY_MS = 40;

/** How wide the path column is before the status, so a run of hits reads as a
 *  table rather than as ragged prose. */
const PATH_COLUMN = 20;

/** The status that means something was served. Everything else the far side reports
 *  is a miss, and a miss is the attacker's silence — loud only on the target. */
const FOUND = 200;

/** Where a sweep is pointed, in the terms both ends need: the url AS TYPED for the
 *  header, the tree to probe, and the resolved address the target's own log is keyed
 *  by — `localhost` names no machine to the server that has to find it. */
type SweepTarget = {
  readonly url: string;
  readonly fs: Directory;
  readonly essid: string;
  readonly address: string;
  readonly port: number;
  readonly sourceIp: string;
};

/** Tell the box what it was just asked for — every probe, in the order tried, as ONE
 *  append. Fire-and-forget like `curl`'s: the sweep has already happened, and neither
 *  a failed write nor an unwired seam can unmake it. Nothing asked, nothing said. */
const reportSweep = (env: CommandEnv, target: SweepTarget, paths: readonly string[]): void => {
  if (paths.length === 0) return;
  try {
    void env.log
      .appendAccessLog({
        essid: target.essid,
        target: target.address,
        port: target.port,
        paths,
        sourceIp: target.sourceIp,
      })
      .catch(() => undefined);
  } catch {
    // best-effort: logging must not surface to the sweep.
  }
};

const formatHit = ({ path, size }: { readonly path: string; readonly size: number }): string =>
  `${path.padEnd(PATH_COLUMN)} (Status: 200) [Size: ${size}]`;

/**
 * The run as the player watches it: what was asked, what answered, and how much of the
 * list that was. One walk however far away the box is — the beat is a deliberate
 * reading rhythm rather than the cost of a probe (a local tree answers instantly too),
 * so a sweep of a stranger reads exactly like a sweep of a neighbour.
 *
 * It is handed one outcome per WORD, already resolved: here against a tree this client
 * holds, across the world by the server that holds the other one.
 */
async function* run(
  env: CommandEnv,
  url: string,
  found: readonly (ProbedPath | null)[],
): AsyncGenerator<TerminalLine, number> {
  yield text('Gobuster dir mode');
  yield text(`[+] Url:       ${url}`);
  yield text(`[+] Wordlist:  ${DIRLIST_PATH}`);
  yield text(`[+] Words:     ${found.length}`);
  yield text('');

  for (const hit of found) {
    await env.sleep(PROBE_DELAY_MS);
    if (hit !== null) {
      yield text(formatHit(hit));
    }
  }

  yield text('');
  yield text(`Finished. ${found.filter((hit) => hit !== null).length}/${found.length} paths found.`);
  return 0;
}

/** A sweep of a box on the player's own network, which resolves entirely here — and
 *  then tells that box what it was asked. After the walk, not during it: the box was
 *  asked all of this by one tool in one run, and a line per probe would be a
 *  round-trip per word. A run the player abandons tells it nothing. */
async function* sweepLocally(
  env: CommandEnv,
  target: SweepTarget,
  words: readonly string[],
): AsyncGenerator<TerminalLine, number> {
  const swept = words.map((word) => sweepWord(target.fs, word));
  const exitCode = yield* run(
    env,
    target.url,
    swept.map((word) => word.found),
  );
  reportSweep(
    env,
    target,
    swept.flatMap((word) => word.asked.map((probed) => probed.path)),
  );
  return exitCode;
}

const execute: Command['execute'] = async (env, args) => {
  const raw = args[0];
  if (raw === undefined) {
    return error(USAGE);
  }

  const url = parseHttpUrl(raw);
  if (url === null) {
    return error(`gobuster: (3) URL rejected: ${raw}`);
  }

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return error(UNREACHABLE);
  }

  // A public address is another player's, and nothing here can resolve it: their
  // tree lives server-side, so the far side runs the sweep and reports what it
  // served. The list crosses no wire — the server reads it off the machine named
  // here, exactly as a credential sweep reads the password list.
  if (isPublicIp(url.host)) {
    const swept = await env.remote.sweepPublic({
      target: url.host,
      port: url.port,
      callerMachineId: env.session.machineId,
    });
    if (!swept.ok) {
      return connectError({
        program: 'gobuster',
        host: url.host,
        port: url.port,
        reason: swept.error === 'host_unreachable' ? 'Connection refused' : 'Network error',
      });
    }
    if (!swept.dirlistFound) {
      return error(NO_LIST);
    }
    return streamedResult(
      run(
        env,
        raw,
        swept.results.map((outcome) => (outcome.status === FOUND ? outcome : null)),
      ),
    );
  }

  const reached = reachWebHost({ root: env.fs.root(), program: 'gobuster', url, wlan0 });
  if (!reached.ok) {
    return reached.failure;
  }
  const { fs: hostFs, essid, address, sourceIp } = reached.host;

  const dirlist = env.fs.read(DIRLIST_PATH);
  if (!dirlist.ok) {
    return error(NO_LIST);
  }

  return streamedResult(
    sweepLocally(
      env,
      {
        url: raw,
        fs: hostFs,
        essid,
        address,
        port: url.port,
        sourceIp,
      },
      parseDirlist(dirlist.content),
    ),
  );
};

export const gobuster: Command = {
  name: 'gobuster',
  description: 'Brute-force paths on a web server to find unlinked pages',
  category: 'network',
  tier: 'guest',
  // Like `curl`, this runs from wherever the player currently stands — a sweep
  // launched from a box they have taken is the point, not an edge case.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'gobuster <url>',
    description:
      'Walk a list of paths against a web server and report the ones that answer. Finds pages ' +
      'and directories nothing links to, which is what a page you can already read will never ' +
      'tell you. Tries every path in the list (/usr/share/wordlists/dirlist.txt) against the ' +
      'target and prints each one that returns something. A path that is not in your list will ' +
      'never be found, however plainly it is sitting there — grow the list by editing it with ' +
      'nano as you see paths referenced elsewhere. Every probe, hit or miss, is recorded in the ' +
      "target's own access log, so a sweep is not a quiet thing to do.",
    arguments: [
      { name: 'url', description: 'The URL to sweep, e.g. http://192.168.1.5', required: true },
    ],
    examples: [
      {
        command: 'gobuster http://192.168.1.5',
        description: 'Sweep a host on your network for unlinked paths',
      },
      {
        command: 'gobuster http://localhost',
        description: 'Sweep your own web server to see what it exposes',
      },
    ],
  },
  execute,
};
