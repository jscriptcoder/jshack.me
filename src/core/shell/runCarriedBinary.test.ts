import { describe, expect, it } from 'vitest';
import { runCommandLine } from './runLine';
import { carriedCommandRegistry, commandRegistry } from '../commands/registry';
import { binaryStub } from '../generation/binaries';
import { SYSTEM_LIBRARIES } from '../generation/libraries';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { asAbsPath, type UserType } from '../types';
import type { FileNode } from '../filesystem/types';
import type { CommandResult, TerminalLine } from '../commands/types';

/**
 * A binary a player carried onto a box — dropped in `/tmp` or their home with
 * `scp` or `ftp put` — runs when they name its path, gated exactly like an
 * installed one: it must be a file, the caller's tier must hold its execute
 * bit, and the libraries it links must be present. What runs is the tool its
 * content names, never the tool its file name suggests.
 */

const ALL_TIERS: readonly UserType[] = ['root', 'user', 'guest'];

type CarriedOptions = {
  readonly content: string;
  readonly execute?: readonly UserType[];
};

const carried = ({ content, execute = ALL_TIERS }: CarriedOptions): FileNode =>
  buildFile(content, { owner: 'guest', perms: { read: ALL_TIERS, execute } });

/** A box with a readable note, the whole library set every generated box
 *  carries, and whatever the test carried into `/tmp`. Nothing but `grep` is
 *  installed in the system directories, so any tool that runs got there by its
 *  path. Pass a narrower `libs` to stage a box a tool cannot link on. */
const buildBox = (
  tmp: Readonly<Record<string, FileNode>>,
  libs: readonly string[] = SYSTEM_LIBRARIES,
) =>
  buildDirectory({
    bin: buildDirectory({
      grep: buildFile(binaryStub('grep'), { owner: 'root', perms: { execute: ALL_TIERS } }),
    }),
    lib: buildDirectory(
      Object.fromEntries(libs.map((lib) => [`${lib}.so`, buildFile(binaryStub(`${lib}.so`))])),
    ),
    etc: buildDirectory({
      motd: buildFile('welcome aboard\n', { owner: 'root', perms: { read: ALL_TIERS } }),
    }),
    tmp: buildDirectory(tmp, { owner: 'guest' }),
  });

const run = async (
  tree: ReturnType<typeof buildBox>,
  line: string,
  userType: UserType = 'guest',
): Promise<Extract<CommandResult, { kind: 'sync' }>> => {
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(tree, { userType, cwd: asAbsPath('/tmp') }),
    session: mockSession({ username: userType, userType }),
  });
  const result = await runCommandLine(env, line, commandRegistry, carriedCommandRegistry);
  if (result.kind !== 'sync') throw new Error(`expected a sync result, got ${result.kind}`);
  return result;
};

const contents = (lines: readonly TerminalLine[]): readonly string[] =>
  lines.map((line) => line.content);

describe('running a carried binary by its path', () => {
  it('runs the tool at an absolute path', async () => {
    const box = buildBox({ msfconsole: carried({ content: binaryStub('msfconsole') }) });

    const result = await run(box, '/tmp/msfconsole');

    expect(contents(result.lines)).toEqual(['usage: msfconsole <host> <port>']);
  });

  it('runs the tool at a path relative to the cwd', async () => {
    const box = buildBox({ tool: carried({ content: binaryStub('cat') }) });

    const result = await run(box, './tool /etc/motd');

    expect(result.exitCode).toBe(0);
    expect(contents(result.lines)).toEqual(['welcome aboard']);
  });

  it('runs the tool its content names, whatever the file is called', async () => {
    const box = buildBox({ msfconsole: carried({ content: binaryStub('cat') }) });

    const result = await run(box, '/tmp/msfconsole /etc/motd');

    expect(contents(result.lines)).toEqual(['welcome aboard']);
  });

  it('refuses a tier the file does not let execute', async () => {
    const box = buildBox({ tool: carried({ content: binaryStub('cat'), execute: ['root'] }) });

    const result = await run(box, '/tmp/tool /etc/motd');

    expect(result.exitCode).toBe(126);
    expect(result.lines).toEqual([{ kind: 'error', content: 'bash: /tmp/tool: Permission denied' }]);
  });

  it('lets root run it whatever the execute bit says, as for an installed binary', async () => {
    const box = buildBox({ tool: carried({ content: binaryStub('cat'), execute: [] }) });

    const result = await run(box, '/tmp/tool /etc/motd', 'root');

    expect(contents(result.lines)).toEqual(['welcome aboard']);
  });

  it('still needs the libraries the tool links', async () => {
    const box = buildBox({ tool: carried({ content: binaryStub('cat') }) }, []);

    const result = await run(box, '/tmp/tool /etc/motd');

    expect(result.exitCode).toBe(127);
    expect(contents(result.lines)).toEqual([
      'cat: error while loading shared libraries: libpcre.so: cannot open shared object file: No such file or directory',
    ]);
  });

  it.each([
    ['nothing at that path', '/tmp/missing', {}],
    ['a directory', '/tmp', {}],
    ['a file that is not a binary', '/tmp/notes', { notes: carried({ content: 'hello\n' }) }],
    ['a shared library', '/tmp/libpcre.so', { 'libpcre.so': carried({ content: binaryStub('libpcre.so') }) }],
    ['a stub naming a shell builtin', '/tmp/fake', { fake: carried({ content: binaryStub('cd') }) }],
    ['a stub naming no command', '/tmp/odd', { odd: carried({ content: binaryStub('constructor') }) }],
  ] as const)('reports %s as no such file', async (_label, path, tmp) => {
    const result = await run(buildBox(tmp), path);

    expect(result.exitCode).toBe(127);
    expect(result.lines).toEqual([
      { kind: 'error', content: `bash: ${path}: No such file or directory` },
    ]);
  });

  it('never runs a carried binary by its bare name', async () => {
    const box = buildBox({ msfconsole: carried({ content: binaryStub('msfconsole') }) });

    const result = await run(box, 'msfconsole');

    expect(result.exitCode).toBe(127);
    expect(contents(result.lines).join('\n')).toContain('bash: msfconsole: command not found');
  });

  it('feeds a pipeline like any other command', async () => {
    const box = buildBox({ tool: carried({ content: binaryStub('cat') }) });

    const result = await run(box, '/tmp/tool /etc/motd | grep welcome');

    expect(contents(result.lines)).toEqual(['welcome aboard']);
  });
});
