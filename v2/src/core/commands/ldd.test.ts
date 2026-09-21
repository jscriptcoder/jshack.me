import { describe, expect, it } from 'vitest';
import { commandRegistry } from './registry';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { binaryStub } from '../generation/binaries';
import { SYSTEM_LIBRARIES, type SystemLibrary } from '../generation/libraries';
import { asAbsPath } from '../types';
import type { FileNode } from '../filesystem/types';
import type { CommandResult, TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const LOAD_ADDRESS = /^\(0x[0-9a-f]{12}\)$/;

const worldExecutableBinary = (name: string): FileNode =>
  buildFile(binaryStub(name), { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } });

const library = (name: string): FileNode => buildFile(binaryStub(`${name}.so`), { owner: 'root' });

type TreeOptions = {
  readonly bin?: readonly string[];
  readonly usrBin?: readonly string[];
  readonly libs?: readonly string[];
  /** Files in `/tmp`, by name, each holding the given content. */
  readonly tmp?: Readonly<Record<string, string>>;
};

/** A box whose `/bin` always holds `ldd` itself, plus the named binaries and
 *  `/lib/<lib>.so` files. */
const buildBox = ({ bin = [], usrBin = [], libs = [], tmp = {} }: TreeOptions) =>
  buildDirectory({
    bin: buildDirectory(
      Object.fromEntries(['ldd', ...bin].map((name) => [name, worldExecutableBinary(name)])),
    ),
    usr: buildDirectory({
      bin: buildDirectory(
        Object.fromEntries(usrBin.map((name) => [name, worldExecutableBinary(name)])),
      ),
    }),
    lib: buildDirectory(Object.fromEntries(libs.map((lib) => [`${lib}.so`, library(lib)]))),
    tmp: buildDirectory(
      Object.fromEntries(
        Object.entries(tmp).map(([name, content]) => [name, buildFile(content, { owner: 'guest' })]),
      ),
      { owner: 'guest' },
    ),
  });

const runLdd = async (
  tree: ReturnType<typeof buildBox>,
  args: readonly string[],
): Promise<Extract<CommandResult, { kind: 'sync' }>> => {
  const ldd = commandRegistry.get('ldd');
  if (ldd === undefined) throw new Error('ldd is not registered');
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(tree, { userType: 'guest', cwd: asAbsPath('/tmp') }),
    session: mockSession({ username: 'guest', userType: 'guest' }),
  });
  const result = await ldd.execute(env, args, NO_FLAGS);
  if (result.kind !== 'sync') throw new Error(`expected a sync result, got ${result.kind}`);
  return result;
};

const linesOfKind = (lines: readonly TerminalLine[], kind: TerminalLine['kind']): string[] =>
  lines.filter((line) => line.kind === kind).map((line) => line.content);

/** Split `\t<lib>.so => /lib/<lib>.so (0x…)` into its resolution and address so
 *  a test can pin the path exactly and the address by shape. */
const parseLine = (line: string) => {
  const match = /^\t(\S+) => (\S+)(?: (.+))?$/.exec(line);
  if (match === null) throw new Error(`not an ldd line: ${JSON.stringify(line)}`);
  return { library: match[1], resolution: match[2], address: match[3] };
};

/** Every library an apt-installed client tool links. Libraries are thematic
 *  capability groups rather than a real dependency chart: a tool that speaks TLS
 *  or the network links libssl, an interactive prompt links libreadline, a
 *  pattern matcher libpcre, a markup reader libxml2, and anything that handles
 *  hashes or ciphers links libcrypt. A tool that belongs to two groups links
 *  both — and its first link is the one a severity tie falls to, which is why
 *  hydra leads with libcrypt: it is a password tool that happens to use the
 *  network, not a network tool that happens to hash. */
const TOOLCHAIN_LINKS: ReadonlyArray<[string, readonly SystemLibrary[]]> = [
  ['nmap', ['libssl']],
  ['dig', ['libssl']],
  ['nslookup', ['libssl']],
  ['nc', ['libssl']],
  ['snmpwalk', ['libssl']],
  ['snmpset', ['libssl']],
  ['ftp', ['libssl', 'libreadline']],
  ['msfconsole', ['libssl', 'libreadline']],
  ['mysql', ['libssl', 'libreadline']],
  ['redis-cli', ['libssl', 'libreadline']],
  ['hydra', ['libcrypt', 'libssl']],
  ['gobuster', ['libssl', 'libpcre']],
  ['lynx', ['libssl', 'libxml2']],
  ['john', ['libcrypt']],
  ['gpg', ['libcrypt']],
  ['airmon-ng', ['libcrypt']],
  ['airodump-ng', ['libcrypt']],
  ['aircrack-ng', ['libcrypt']],
  ['node', ['libreadline']],
];

describe('ldd', () => {
  it('lists every library a command links, in link order, with its path and a load address', async () => {
    const box = buildBox({ bin: ['su'], libs: ['libpam', 'libcrypt'] });

    const result = await runLdd(box, ['su']);

    expect(result.exitCode).toBe(0);
    const lines = linesOfKind(result.lines, 'text').map(parseLine);
    expect(lines.map(({ library, resolution }) => [library, resolution])).toEqual([
      ['libpam.so', '/lib/libpam.so'],
      ['libcrypt.so', '/lib/libcrypt.so'],
    ]);
    lines.forEach(({ address }) => expect(address).toMatch(LOAD_ADDRESS));
  });

  it('gives each library the same address on every run and a different one from its neighbour', async () => {
    const box = buildBox({ bin: ['su'], libs: ['libpam', 'libcrypt'] });

    const first = linesOfKind((await runLdd(box, ['su'])).lines, 'text');
    const second = linesOfKind((await runLdd(box, ['su'])).lines, 'text');

    expect(second).toEqual(first);
    const [pam, crypt] = first.map(parseLine);
    expect(pam?.address).not.toBe(crypt?.address);
  });

  it('prints the same address legacy ldd printed for the same library', async () => {
    const box = buildBox({ bin: ['su'], libs: ['libpam', 'libcrypt'] });

    const [pamLine] = linesOfKind((await runLdd(box, ['su'])).lines, 'text');

    expect(pamLine).toBe('\tlibpam.so => /lib/libpam.so (0x0000c290d755)');
  });

  it('shows the single libpcre dependency of grep', async () => {
    const box = buildBox({ bin: ['grep'], libs: ['libpcre'] });

    const result = await runLdd(box, ['grep']);

    const libraries = linesOfKind(result.lines, 'text').map((line) => parseLine(line).library);
    expect(libraries).toEqual(['libpcre.so']);
  });

  it('marks a removed library as not found, keeps listing the rest, and still exits 0', async () => {
    const box = buildBox({ bin: ['su'], libs: ['libcrypt'] });

    const result = await runLdd(box, ['su']);

    expect(result.exitCode).toBe(0);
    const lines = linesOfKind(result.lines, 'text');
    expect(lines[0]).toBe('\tlibpam.so => not found');
    expect(parseLine(lines[1] ?? '')).toMatchObject({
      library: 'libcrypt.so',
      resolution: '/lib/libcrypt.so',
    });
  });

  it('answers for a path exactly as for the bare name', async () => {
    const box = buildBox({ bin: ['su'], libs: ['libpam', 'libcrypt'] });

    expect(await runLdd(box, ['/bin/su'])).toEqual(await runLdd(box, ['su']));
  });

  it('resolves a bare name through /usr/bin as well as /bin', async () => {
    const box = buildBox({ usrBin: ['su'], libs: ['libpam', 'libcrypt'] });

    const result = await runLdd(box, ['su']);

    expect(result.exitCode).toBe(0);
    expect(linesOfKind(result.lines, 'text')).toHaveLength(2);
  });

  it.each([['mkdir'], ['touch'], ['man'], ['ping'], ['ifconfig'], ['nmcli'], ['clear'], ['whoami']])(
    'reports %s as not a dynamic executable, because a utility that links nothing is never mapped',
    async (command) => {
      const box = buildBox({ bin: [command], libs: SYSTEM_LIBRARIES });

      const result = await runLdd(box, [command]);

      expect(result.exitCode).toBe(1);
      expect(linesOfKind(result.lines, 'text')).toEqual(['\tnot a dynamic executable']);
    },
  );

  it.each(TOOLCHAIN_LINKS)(
    'lists the libraries %s links, in link order',
    async (command, libraries) => {
      const box = buildBox({ bin: [command], libs: libraries });

      const result = await runLdd(box, [command]);

      expect(result.exitCode).toBe(0);
      expect(linesOfKind(result.lines, 'text').map((line) => parseLine(line).library)).toEqual(
        libraries.map((library) => `${library}.so`),
      );
    },
  );

  it.each(TOOLCHAIN_LINKS)(
    'marks the library %s links first as not found once its .so is gone',
    async (command, libraries) => {
      const [first, ...rest] = libraries;
      const box = buildBox({ bin: [command], libs: rest });

      const result = await runLdd(box, [command]);

      expect(linesOfKind(result.lines, 'text')[0]).toBe(`\t${first}.so => not found`);
    },
  );

  it.each([['su'], ['/bin/su']])(
    'reports %s as missing when the binary is gone, without consulting the library map',
    async (arg) => {
      const box = buildBox({ libs: ['libpam', 'libcrypt'] });

      const result = await runLdd(box, [arg]);

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([
        { kind: 'error', content: `ldd: ${arg}: No such file or directory` },
      ]);
    },
  );

  it('takes a path literally rather than searching for its basename', async () => {
    const box = buildBox({ bin: ['su'], libs: ['libpam', 'libcrypt'] });

    const result = await runLdd(box, ['/tmp/su']);

    expect(result.lines).toEqual([
      { kind: 'error', content: 'ldd: /tmp/su: No such file or directory' },
    ]);
  });

  it('answers for a renamed copy by the tool its content names, not by its file name', async () => {
    const box = buildBox({
      bin: ['su'],
      libs: ['libpam', 'libcrypt'],
      tmp: { foo: binaryStub('su') },
    });

    expect((await runLdd(box, ['/tmp/foo'])).lines).toEqual((await runLdd(box, ['su'])).lines);
  });

  it('answers for what a file is even when it is named after another tool', async () => {
    const box = buildBox({ bin: ['grep'], libs: ['libpcre'], tmp: { su: binaryStub('grep') } });

    expect((await runLdd(box, ['/tmp/su'])).lines).toEqual((await runLdd(box, ['grep'])).lines);
  });

  it('reports a file that is not a binary at all as not a dynamic executable', async () => {
    const box = buildBox({ tmp: { su: 'just some text\n' } });

    const result = await runLdd(box, ['/tmp/su']);

    expect(result.exitCode).toBe(1);
    expect(linesOfKind(result.lines, 'text')).toEqual(['\tnot a dynamic executable']);
  });

  it('treats a stub naming a built-in object property as linking nothing', async () => {
    const box = buildBox({ tmp: { odd: binaryStub('constructor') } });

    const result = await runLdd(box, ['/tmp/odd']);

    expect(linesOfKind(result.lines, 'text')).toEqual(['\tnot a dynamic executable']);
  });

  it('refuses a directory as not a regular file', async () => {
    const box = buildBox({});

    const result = await runLdd(box, ['/bin']);

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([{ kind: 'error', content: 'ldd: /bin: not regular file' }]);
  });

  it('inspects only the first argument', async () => {
    const box = buildBox({ bin: ['su', 'grep'], libs: ['libpam', 'libcrypt', 'libpcre'] });

    expect(await runLdd(box, ['su', 'grep'])).toEqual(await runLdd(box, ['su']));
  });

  it('asks for a file when given none', async () => {
    const result = await runLdd(buildBox({}), []);

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([{ kind: 'error', content: 'ldd: missing file arguments' }]);
  });
});
