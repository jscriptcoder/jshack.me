import { describe, expect, it } from 'vitest';
import { runCommandLine } from '../shell/runLine.js';
import { commandRegistry } from '../commands/registry.js';
import { generateHomeLan } from './generateHomeLan.js';
import { buildRemoteHostFs } from './remoteHostFs.js';
import { buildDeepHostFs } from './deepHostFs.js';
import { crackableEssidPool } from './generateWifi.js';
import { DRAWN_ROLES } from './machineRole.js';
import { NETWORK_CATEGORIES } from './pools/essidCatalog.js';
import { GATEWAY_ROOT_HISTORY, ROLE_ROOT_HISTORY, ROOT_HISTORY } from './pools/rootContent.js';
import { PERSONAL_HISTORY, WORK_HISTORY } from './pools/homeHistory.js';
import type { CommandEnv } from '../commands/types.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv.js';
import { asAbsPath } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import {
  ALL_ESSIDS,
  deepBoxes,
  filesUnder,
  gatewaysOn,
  lanBoxes,
} from '../../test/worldContent.js';

/**
 * A player who gets onto a box and replays its `.bash_history` should never be told a
 * line its owner supposedly typed is not a line this shell accepts. A tool the game
 * does not ship answering `command not found` is fine — a real history names programs
 * the box no longer has — and so is a file the box does not hold. What is not fine is
 * a SHIPPED command refusing the line's own syntax, because that is the game
 * contradicting itself.
 */

const REFUSAL = /: unrecognized option: |E: Invalid operation |no manual entry for |^usage: /i;

const filled = (line: string): string =>
  line
    .replaceAll('{note}', 'todo.txt')
    .replaceAll('{first}', 'ann')
    .replaceAll('{colleague}', 'bob')
    .replaceAll('{count}', '3');

const anNpcBox = () => {
  const essid = 'PLANTED-HISTORY';
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error('the network has no machine to stand on');
  return buildRemoteHostFs(essid, host);
};

const shellAs = (username: string, userType: 'root' | 'user'): CommandEnv =>
  mockCommandEnv({
    session: mockSession({ username, userType }),
    fs: mockFsViewFromTree(anNpcBox(), {
      userType,
      cwd: asAbsPath(userType === 'root' ? '/root' : `/home/${username}`),
    }),
    patches: mockPatchApi({
      write: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
      mkdir: async () => ({ ok: true }),
      setDirectoryPermissions: async () => ({ ok: true }),
    }),
  });

/** Every line of `pool` the shell refuses, with what it said. */
const refusedLines = async (
  pool: readonly string[],
  env: () => CommandEnv,
): Promise<readonly string[]> => {
  const verdicts = await Promise.all(
    pool.map(async (line) => {
      const result = await runCommandLine(env(), filled(line), commandRegistry);
      const errors =
        result.kind === 'sync' ? result.lines.filter((out) => out.kind === 'error') : [];
      const refusal = errors.find((out) => REFUSAL.test(out.content));
      return refusal === undefined ? null : `${line} → ${refusal.content}`;
    }),
  );
  return verdicts.filter((verdict) => verdict !== null);
};

const root = () => shellAs('root', 'root');
const person = () => shellAs('ann', 'user');

describe('a planted shell history the player replays', () => {
  it("holds no line the shell refuses in any box's root history", async () => {
    expect(await refusedLines(ROOT_HISTORY, root)).toEqual([]);
  });

  it("holds no line the shell refuses in a gateway's root history", async () => {
    expect(await refusedLines(GATEWAY_ROOT_HISTORY, root)).toEqual([]);
  });

  it.each(DRAWN_ROLES)('holds no line the shell refuses in a %s root history', async (role) => {
    expect(await refusedLines(ROLE_ROOT_HISTORY[role], root)).toEqual([]);
  });

  it("holds no line the shell refuses in a person's own history", async () => {
    expect(await refusedLines(PERSONAL_HISTORY, person)).toEqual([]);
  });

  it.each(NETWORK_CATEGORIES)(
    'holds no line the shell refuses in the history of someone on a %s network',
    async (category) => {
      expect(await refusedLines(WORK_HISTORY[category], person)).toEqual([]);
    },
  );
});

/** What a line's syntax turns on: the program, a bare-word subcommand after it, every
 *  flag, and how many words follow. Two lines of one shape differ only in the hosts,
 *  paths and numbers they name, which no refusal here depends on. */
const shapeOf = (line: string): string => {
  const [program = '', ...rest] = line.split(/\s+/);
  const subcommand = /^[a-z]+$/.test(rest[0] ?? '') ? rest[0] : '';
  const flags = rest.filter((word) => word.startsWith('-'));
  return [program, subcommand, ...flags, rest.length].join(' ');
};

/** One real line for each shape of line any box or gateway in the world plants. */
const plantedShapes = (): readonly string[] => {
  const trees: readonly Directory[] = [
    ...lanBoxes(ALL_ESSIDS).map(({ essid, host }) => buildRemoteHostFs(essid, host)),
    ...deepBoxes(crackableEssidPool).map(({ essid, host }) => buildDeepHostFs(essid, host)),
    ...gatewaysOn(ALL_ESSIDS).map((gateway) => gateway.tree),
  ];
  const lines = trees.flatMap((tree) =>
    [...filesUnder(tree)]
      .filter(([path]) => path.endsWith('.bash_history'))
      .flatMap(([, content]) => content.split('\n').filter((line) => line !== '')),
  );
  return [...new Map(lines.map((line) => [shapeOf(line), line] as const)).values()];
};

describe('the histories the world plants on its boxes and gateways', () => {
  it('hold no line the shell refuses, including the lines generated from the box itself', async () => {
    expect(await refusedLines(plantedShapes(), root)).toEqual([]);
  });
});
