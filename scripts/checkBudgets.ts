/**
 * The two budgets a growing generated world must stay inside, checked after every build.
 *
 * Every generated machine gets believable content, drawn from large pools. Two costs grow
 * with that content and neither shows up as a failing test:
 * - **bytes shipped** — the pools live in the client bundle, so the gzipped main chunk may
 *   grow by at most 150 KB over its size before world content began;
 * - **time to build a box** — base trees are rebuilt on every lookup, client and server,
 *   with no cache, so each box must stay cheap to regenerate.
 *
 * A breach fails the build with the number that broke. The remedy for a slow box is a
 * cache introduced for that measured reason; the remedy for a heavy bundle is trimming
 * pools. See `docs/conventions-and-gotchas.md` §3.
 *
 * This is a script and not a vitest test because mutation testing runs the whole suite
 * under instrumentation, several times slower, and aborts its dry run on any failure: a
 * wall-clock assertion there would break mutation runs for reasons unrelated to the code
 * being mutated.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import { generateHomeLan } from '../src/core/generation/generateHomeLan';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer';
import { chainLinks, lanHostOctet, machineIdForLanHost } from '../src/core/generation/lanTopology';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import {
  baseFsForLanHost,
  generatedBaseFsForMachineId,
} from '../src/core/generation/lanHostIdentity';

/** 134,975 bytes gzipped before any world content, plus the 150 KB the content may add. */
const BUNDLE_CEILING_BYTES = 284_975;

/** About a tenth of that before world content, so a loaded machine's noise cannot fail
 *  the check while a content change that makes boxes ten times dearer still does. */
const BUILD_CEILING_MS_PER_BOX = 2;

const DIST_DIR = join(import.meta.dirname, '..', 'dist');

type Verdict = { readonly passed: boolean; readonly line: string };

/** The entry chunk `index.html` loads — the one every player downloads before play. */
const mainChunkPath = (): string => {
  const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
  const entry = /<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/.exec(html)?.[1];
  if (entry === undefined) {
    throw new Error('checkBudgets: no module entry script in dist/index.html');
  }
  return join(DIST_DIR, entry);
};

const checkBundle = (): Verdict => {
  const gzippedBytes = gzipSync(readFileSync(mainChunkPath())).length;
  return {
    passed: gzippedBytes <= BUNDLE_CEILING_BYTES,
    line: `bundle: main chunk ${gzippedBytes.toLocaleString('en')} B gzipped (ceiling ${BUNDLE_CEILING_BYTES.toLocaleString('en')} B)`,
  };
};

/** One way to build one generated box's base tree, the same way the game resolves it. */
type BoxBuild = () => unknown;

/** Every box a catalog network generates. The AP gateway at `.1` is built directly because
 *  it belongs to the access point and so is deliberately absent from the machine-id
 *  lookup; every other box — LAN hosts, chain gateways, deep NPCs — goes through that
 *  lookup, which is the path a session pays on every read. */
const boxBuildsOf = (essid: string): readonly BoxBuild[] => {
  const lanHosts = generateHomeLan(essid).hosts;
  const apGateway = lanHosts.filter((host) => lanHostOctet(host) === 1);
  const lanMachineIds = lanHosts
    .filter((host) => lanHostOctet(host) !== 1)
    .map((host) => machineIdForLanHost(host, essid));
  const links = chainLinks(essid);
  const deepGatewayIds = links
    .filter((link) => link.parentMachineId !== null)
    .map((link) => link.machineId);
  const deepNpcIds = links.map((link) =>
    hostMachineId(
      generateDeepLayer(essid, { machineId: link.machineId, kind: link.host.kind }).host,
      essid,
    ),
  );
  const lookup = (machineId: string): BoxBuild => () => {
    // A lookup that found nothing would be timed as a very fast box; refuse to measure it.
    const tree = generatedBaseFsForMachineId(essid, machineId);
    if (tree === null) {
      throw new Error(`checkBudgets: ${essid} does not generate ${machineId}`);
    }
    return tree;
  };
  return [
    ...apGateway.map((host) => () => baseFsForLanHost(host, essid)),
    ...[...lanMachineIds, ...deepGatewayIds, ...deepNpcIds].map(lookup),
  ];
};

const checkBuildTime = (): Verdict => {
  const boxBuilds = crackableEssidPool.flatMap(boxBuildsOf);
  // The first pass pays for JIT compilation, which no player's session pays per box.
  boxBuilds.forEach((build) => build());
  const startedAt = performance.now();
  boxBuilds.forEach((build) => build());
  const msPerBox = (performance.now() - startedAt) / boxBuilds.length;
  return {
    passed: msPerBox <= BUILD_CEILING_MS_PER_BOX,
    line: `build time: ${msPerBox.toFixed(3)} ms per box over ${boxBuilds.length} boxes on ${crackableEssidPool.length} networks (ceiling ${BUILD_CEILING_MS_PER_BOX} ms)`,
  };
};

const verdicts = [checkBundle(), checkBuildTime()];
verdicts.forEach((verdict) => {
  console.log(`${verdict.passed ? 'ok  ' : 'FAIL'} ${verdict.line}`);
});
if (verdicts.some((verdict) => !verdict.passed)) {
  console.error('checkBudgets: a world budget is exceeded — see docs/conventions-and-gotchas.md §3');
  process.exit(1);
}
