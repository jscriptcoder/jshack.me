/**
 * The generated devices a test reads, and the readers more than one device's tests share:
 * every box of a kind in the world, synthetic boxes for the kinds the world holds few of,
 * and what a camera or a recorder holds, read the way a player reads it.
 */

import { buildRemoteHostFs, hostServices } from '../core/generation/remoteHostFs';
import { buildDeepHostFs } from '../core/generation/deepHostFs';
import { strings } from '../core/commands/strings';
import type { TerminalLine } from '../core/commands/types';
import { createFsView } from '../core/filesystem/fsView';
import { asAbsPath } from '../core/types';
import type { Directory } from '../core/filesystem/types';
import type { LanHost } from '../core/generation/generateHomeLan';
import { buildDirectory, buildFile } from './factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from './factories/commandEnv';
import { ALL_ESSIDS, deepBoxes, filesUnder, lanBoxes, type Box } from './worldContent';

export const prefixOf = (hostname: string): string => hostname.slice(0, hostname.lastIndexOf('-'));

/** A box built the way the world builds it: a LAN box as the LAN does, a deep one with
 *  its forced sshd. */
export type BuiltBox = Box & { readonly tree: Directory; readonly layer: 'lan' | 'deep' };

/** Every box of these prefixes in the world, LAN and deep, built inside the calling test
 *  so a mutant is credited to the test that reads it. */
export const worldBoxesNamed = (prefixes: readonly string[]): readonly BuiltBox[] => [
  ...lanBoxes(ALL_ESSIDS)
    .filter(({ host }) => prefixes.includes(prefixOf(host.hostname)))
    .map((box) => ({ ...box, tree: buildRemoteHostFs(box.essid, box.host), layer: 'lan' as const })),
  ...deepBoxes(ALL_ESSIDS)
    .filter(({ host }) => prefixes.includes(prefixOf(host.hostname)))
    .map(({ essid, host }) => ({
      essid,
      host,
      tree: buildDeepHostFs(essid, host),
      layer: 'deep' as const,
    })),
];

const SYNTHETIC_ESSID = 'BEAN-THERE-WIFI';

/** A box named `<prefix>-<octet>` that no network generated: it stands on no home LAN,
 *  so it is built the way a deep box is, knowing only itself. */
export const syntheticBoxes = (prefix: string): readonly BuiltBox[] =>
  Array.from({ length: 120 }, (_, index) => index + 2).map((octet) => {
    const host: LanHost = { ip: `10.77.3.${octet}`, hostname: `${prefix}-${octet}`, kind: 'machine' };
    return {
      essid: SYNTHETIC_ESSID,
      host,
      tree: buildDeepHostFs(SYNTHETIC_ESSID, host),
      layer: 'deep' as const,
    };
  });

/** Home LANs the catalog does not hold, the way a player's own router or a stranger's
 *  factory name makes one: any ESSID generates a whole network, so these carry the
 *  kinds and neighbourhoods the catalog's fifty networks hold too few of. */
export const SYNTHETIC_LAN_ESSIDS = Array.from({ length: 120 }, (_, index) => `HOME-NET-${index}`);

/** The boxes of these prefixes on the synthetic home LANs, built as their LAN builds them. */
export const syntheticLanBoxes = (prefixes: readonly string[]): readonly BuiltBox[] =>
  lanBoxes(SYNTHETIC_LAN_ESSIDS)
    .filter(({ host }) => prefixes.includes(prefixOf(host.hostname)))
    .map((box) => ({ ...box, tree: buildRemoteHostFs(box.essid, box.host), layer: 'lan' as const }));

export const read = (tree: Directory, path: string, tier: 'root' | 'user' | 'guest' = 'root') =>
  createFsView(tree, { userType: tier }).read(asAbsPath(path));

export const contentOf = (tree: Directory, path: string): string => {
  const result = read(tree, path);
  if (!result.ok) throw new Error(`${path}: ${result.error}`);
  return result.content;
};


const NO_FLAGS = new Map<string, string | true>();

/** What a player reads with `strings` on a file holding `content`: the real command's
 *  own run extraction, so every claim below is one a player can see. */
export const readableLinesOf = async (content: string): Promise<readonly string[]> => {
  const result = await strings.execute(
    mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ document: buildFile(content, { owner: 'root' }) }), {
        userType: 'root',
        cwd: asAbsPath('/'),
      }),
    }),
    ['/document'],
    NO_FLAGS,
  );
  if (result.kind !== 'sync') throw new Error('strings answered asynchronously');
  return result.lines
    .filter((line: TerminalLine) => line.kind === 'text')
    .map((line) => line.content);
};


export const CAMERA_PREFIXES = ['cam', 'doorbell', 'babycam'];

/** Every camera-kind box: the world's, LAN and deep, and synthetic ones of each flavour
 *  on both layers, since the world holds only a few of each. */
export const cameras = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(CAMERA_PREFIXES),
  ...syntheticLanBoxes(CAMERA_PREFIXES).slice(0, 40),
  ...CAMERA_PREFIXES.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 15)),
];

/** One entry of a camera's event index. */
export type CameraEvent = {
  /** When it happened, in milliseconds. */
  readonly at: number;
  readonly kind: string;
  readonly snapshot: string;
};

const EVENT_LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) (\S+) (snapshots\/\S+\.jpg)$/;

export const eventsOf = (tree: Directory): readonly CameraEvent[] =>
  contentOf(tree, '/var/lib/motion/events.log')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = EVENT_LINE.exec(line);
      if (match === null) throw new Error(`not an event line: ${line}`);
      const [, year, month, day, hours, minutes, seconds, kind = '', snapshot = ''] = match;
      return {
        at: Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        ),
        kind,
        snapshot,
      };
    });

/** The camera a motion config names, as `camera_name <make> <model>` spells it. */
export const cameraNameOf = (tree: Directory): string =>
  /^camera_name (.+)$/m.exec(contentOf(tree, '/etc/motion/motion.conf'))?.[1] ?? '';

/** Every recorder: the world's, LAN and deep, and synthetic ones on both layers. */
export const recorders = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(['nvr']),
  ...syntheticLanBoxes(['nvr']).slice(0, 25),
  ...syntheticBoxes('nvr').slice(0, 20),
];

/** The files a recorder archives, by path beneath `/var/lib/nvr`, the index left out. */
export const archiveOf = (tree: Directory): ReadonlyMap<string, string> => {
  const node = createFsView(tree, { userType: 'root' }).stat(asAbsPath('/var/lib/nvr'));
  if (node?.kind !== 'directory') throw new Error('no /var/lib/nvr');
  return new Map([...filesUnder(node)].filter(([path]) => path !== 'index.log'));
};

/** The directories a recorder archives under, one per camera or channel it records. */
export const archivedSources = (tree: Directory): ReadonlySet<string> =>
  new Set([...archiveOf(tree).keys()].map((path) => path.slice(0, path.indexOf('/'))));

export const servesHttp = ({ essid, host }: Box): boolean =>
  hostServices(essid, host).some(({ spec }) => spec.service === 'http');

export const pagesOf = (tree: Directory): ReadonlyMap<string, string> => {
  const node = createFsView(tree, { userType: 'root' }).stat(asAbsPath('/var/www/html'));
  return node?.kind === 'directory' ? filesUnder(node) : new Map();
};
