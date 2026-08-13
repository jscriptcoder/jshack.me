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
import { createFsView } from '../filesystem/fsView';
import { parseHttpUrl, resolveWebPath } from '../network/http';
import { DIRLIST_PATH, parseDirlist } from '../network/defaultDirlist';
import { isPublicIp } from '../generation/ip';
import { connectedWlan0 } from '../network/interfaces';
import { reachWebHost } from './webHost';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const USAGE = 'gobuster: usage: gobuster <url> (e.g. gobuster http://192.168.1.5)';

const UNREACHABLE = 'gobuster: (7) Failed to connect — network is unreachable';

/** Cross-network sweeps have no server path yet. Named plainly rather than dressed
 *  as a connect failure: a player whose sweep is unsupported must not spend the
 *  evening believing the target refused them. */
const NOT_ON_YOUR_NETWORK =
  'gobuster: only hosts on your own network can be swept — cross-network sweeps are not supported yet';

/** Beat between probes. Short, because a sweep is many requests rather than a few
 *  slow ones, and a list of forty should not take a minute to walk. */
const PROBE_DELAY_MS = 40;

/** How wide the path column is before the status, so a run of hits reads as a
 *  table rather than as ragged prose. */
const PATH_COLUMN = 20;

/** One path that answered, and the size of what came back. */
type Hit = {
  readonly path: string;
  readonly size: number;
};

/** What one word asked of the server, and what came back. `asked` is what the TARGET
 *  is told about rather than what the player is shown: a word naming a directory costs
 *  two requests, and a traversal costs one the sweeper is never told the fate of. */
type Probe = {
  readonly asked: readonly string[];
  readonly hit: Hit | null;
};

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

/**
 * What `word` gets back, or null when the server has nothing to serve there.
 *
 * Read as the SERVER, like `curl` does: a web server serves its document root under
 * its own account, and a sweeper has no account on that box at all. The confinement
 * is the document root, never the file permissions.
 *
 * A word naming a DIRECTORY is a hit when that directory holds an index — a real
 * server redirects to the trailing-slash form and serves it, which is exactly how a
 * player finds a folder they were never linked to. A directory with no index serves
 * nothing and is not a find.
 */
const probe = (hostFs: Directory, word: string): Probe => {
  const requestPath = `/${word}`;
  const asked = [requestPath];
  const filePath = resolveWebPath(requestPath);
  // A path that climbs out of the published directory names nothing, and is not
  // distinguishable from a miss — telling a sweeper their traversal was SPOTTED is
  // itself a hint worth withholding. The TARGET is still told it was asked: silence
  // is owed to the attacker, not to the box's owner.
  if (filePath === null) return { asked, hit: null };

  const view = createFsView(hostFs, { userType: 'root' });
  const served = view.read(filePath);
  if (served.ok) return { asked, hit: { path: requestPath, size: served.content.length } };
  // Known-equivalent under mutation, deliberately kept: removing this guard only
  // makes a `not_found` take the directory retry as well, which fails the same way
  // (nothing can live under a path that does not exist), and root reading means
  // `permission_denied` never occurs. It states the intent and saves the work.
  if (served.error !== 'is_directory') return { asked, hit: null };

  const indexPath = resolveWebPath(`${requestPath}/`);
  // Also known-equivalent, and required by the type rather than by a case: a path
  // that escaped the document root already returned above, so appending a slash
  // cannot escape either. `resolveWebPath` still hands back a nullable, and this is
  // what narrows it.
  if (indexPath === null) return { asked, hit: null };
  const index = view.read(indexPath);
  return {
    // Two requests reached the server for this one word, and the log records both —
    // the bare path a real server redirects, and the form it redirects TO.
    asked: [...asked, `${requestPath}/`],
    hit: index.ok ? { path: `${requestPath}/`, size: index.content.length } : null,
  };
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

const formatHit = ({ path, size }: Hit): string =>
  `${path.padEnd(PATH_COLUMN)} (Status: 200) [Size: ${size}]`;

async function* run(
  env: CommandEnv,
  target: SweepTarget,
  words: readonly string[],
): AsyncGenerator<TerminalLine, number> {
  yield text('Gobuster dir mode');
  yield text(`[+] Url:       ${target.url}`);
  yield text(`[+] Wordlist:  ${DIRLIST_PATH}`);
  yield text(`[+] Words:     ${words.length}`);
  yield text('');

  const probes: Probe[] = [];
  for (const word of words) {
    await env.sleep(PROBE_DELAY_MS);
    const probed = probe(target.fs, word);
    probes.push(probed);
    if (probed.hit !== null) {
      yield text(formatHit(probed.hit));
    }
  }

  // After the walk, not during it: the box was asked all of this by one tool in one
  // run, and a line per probe would be a round-trip per word.
  reportSweep(
    env,
    target,
    probes.flatMap((probed) => probed.asked),
  );

  const found = probes.filter((probed) => probed.hit !== null).length;
  yield text('');
  yield text(`Finished. ${found}/${words.length} paths found.`);
  return 0;
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

  if (isPublicIp(url.host)) {
    return error(NOT_ON_YOUR_NETWORK);
  }

  const reached = reachWebHost({ root: env.fs.root(), program: 'gobuster', url, wlan0 });
  if (!reached.ok) {
    return reached.failure;
  }
  const { fs: hostFs, essid, address, sourceIp } = reached.host;

  // Without a list there is nothing to try, and reporting "0 found" would read as a
  // server with nothing on it rather than as a missing wordlist.
  const dirlist = env.fs.read(DIRLIST_PATH);
  if (!dirlist.ok) {
    return error(
      `gobuster: no wordlist at ${DIRLIST_PATH} — install one with: apt install gobuster`,
    );
  }

  return streamedResult(
    run(
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
