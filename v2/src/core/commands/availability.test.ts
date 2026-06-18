import { describe, expect, it } from 'vitest';
import { wrapWithBinaryCheck } from './availability';
import { wrapWithLibraryCheck } from './libraryDeps';
import { commandRegistry } from './registry';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';

/**
 * Slice 1 of the binary/availability model: a command only runs when its
 * `/bin/<name>` binary exists on the CURRENT machine and the session tier may
 * execute it — otherwise the canonical bash error. The wrapper reads `env.fs`
 * at execution time (per-machine, mutable), so removing/restoring a binary
 * flips the command between not-found and working.
 *
 * These tests prove the wrapper's behaviour (presence + execute-perm gating)
 * and the registry wiring (gated commands are wrapped; always-available
 * builtins/game commands are not) — the integration seam.
 */

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: CommandResult): readonly string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === 'text').map((line) => line.content)
    : [];

const errorLines = (result: CommandResult): readonly string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === 'error').map((line) => line.content)
    : [];

/** A fake gated command that echoes its positional args, so a test can prove
 *  the wrapper delegated through to it (and passed args untouched). */
const echoArgsCommand = (name: string): Command => ({
  name,
  description: 'fake echo-args command',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  execute: async (_env: CommandEnv, args: readonly string[]): Promise<CommandResult> => ({
    kind: 'sync',
    lines: [{ kind: 'text', content: args.join(',') } satisfies TerminalLine],
    exitCode: 0,
  }),
});

/** Build a tree whose `/bin` holds one stub binary at the given execute perms. */
const treeWithBinary = (name: string, execute: readonly ('root' | 'user' | 'guest')[]) =>
  buildDirectory({
    bin: buildDirectory({
      [name]: buildFile('', { owner: 'root', perms: { execute } }),
    }),
  });

describe('wrapWithBinaryCheck', () => {
  it('delegates to the wrapped command when /bin/<name> exists and the tier may execute it', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithBinary('ls', ['root', 'user', 'guest']), {
        userType: 'user',
      }),
    });

    const result = await wrapped.execute(env, ['a', 'b'], NO_FLAGS);

    // Proves delegation AND that args passed through untouched.
    expect(textLines(result)).toEqual(['a,b']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('returns command-not-found (exit 127) when the /bin binary is absent', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      // No /bin at all.
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('returns Permission denied (exit 126) when the binary excludes the session tier', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('reboot'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithBinary('reboot', ['root']), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: reboot: Permission denied']);
    expect(result.kind === 'sync' && result.exitCode).toBe(126);
  });

  it('lets root bypass the execute-perm check — runs even a non-executable binary', async () => {
    // A binary with execute: [] is the kill vector for the `userType === 'root'`
    // bypass mutant: only the root short-circuit (not the array membership)
    // lets root through.
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('reboot'));
    const rootEnv = mockCommandEnv({
      session: { ...mockCommandEnv().session, userType: 'root' },
      fs: mockFsViewFromTree(treeWithBinary('reboot', []), { userType: 'root' }),
    });

    const result = await wrapped.execute(rootEnv, ['now'], NO_FLAGS);

    expect(textLines(result)).toEqual(['now']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('denies a non-executable binary to a non-root tier', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('reboot'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithBinary('reboot', []), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: reboot: Permission denied']);
  });

  it('treats a directory named like the binary as not-found (only a file is executable)', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      // /bin/ls exists, but as a directory — not a runnable binary.
      fs: mockFsViewFromTree(buildDirectory({ bin: buildDirectory({ ls: buildDirectory({}) }) }), {
        userType: 'user',
      }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('preserves the wrapped command metadata (name, category, tier, manual)', () => {
    const original = echoArgsCommand('ls');
    const wrapped = wrapWithBinaryCheck(original);
    expect(wrapped.name).toBe('ls');
    expect(wrapped.category).toBe(original.category);
    expect(wrapped.tier).toBe(original.tier);
  });
});

describe('commandRegistry gating (registry wiring)', () => {
  it('runs an always-available builtin with no /bin entry present', async () => {
    const echo = commandRegistry.get('echo');
    if (echo === undefined) throw new Error('echo not registered');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await echo.execute(env, ['hello'], NO_FLAGS);

    expect(textLines(result)).toEqual(['hello']);
  });

  // Every always-available command (builtins + game commands) must run with NO
  // binary on the filesystem — that IS the "always available" contract. Driving
  // each through the registry against an empty /bin kills the set-membership
  // literals: drop one from the set and that command gets gated → not-found.
  it.each(['cd', 'echo', 'pwd', 'help', 'identity'])(
    'runs the always-available command %s with no binary on the filesystem',
    async (name) => {
      const command = commandRegistry.get(name);
      if (command === undefined) throw new Error(`${name} not registered`);
      const env = mockCommandEnv({
        // A home dir so `cd` has somewhere valid to land; no /bin anywhere.
        fs: mockFsViewFromTree(
          buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) }),
          {
            userType: 'user',
            cwd: asAbsPath('/home/alice'),
          },
        ),
      });

      const result = await command.execute(env, [], NO_FLAGS);

      const hitGate = errorLines(result).some((line) => line.includes('command not found'));
      expect(hitGate).toBe(false);
    },
  );

  it('gates ls behind /bin/ls — command-not-found when the binary is absent', async () => {
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ tmp: buildDirectory({}) }), {
        userType: 'user',
        cwd: asAbsPath('/tmp'),
      }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('runs ls normally when /bin/ls is present', async () => {
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const tree = buildDirectory({
      bin: buildDirectory({
        ls: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
      }),
      // ls also links libpcre (slice 3) — present so it isn't linker-gated here.
      lib: buildDirectory({ 'libpcre.so': libFile() }),
      tmp: buildDirectory({ 'note.txt': buildFile('x', { owner: 'alice' }) }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(textLines(result)).toEqual(['note.txt']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });
});

/** Build a tree whose `/usr/bin` holds one world-executable stub binary. */
const treeWithUsrBinary = (name: string) =>
  buildDirectory({
    usr: buildDirectory({
      bin: buildDirectory({
        [name]: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
      }),
    }),
  });

/** Build a tree whose `/usr/sbin` holds one world-executable stub binary. */
const treeWithSbinBinary = (name: string) =>
  buildDirectory({
    usr: buildDirectory({
      sbin: buildDirectory({
        [name]: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
      }),
    }),
  });

describe('wrapWithBinaryCheck — /usr/bin resolution + apt-install hint (slice 2)', () => {
  it('resolves a binary from /usr/bin when it is not in /bin', async () => {
    // aircrack is a pre-installed apt tool: it lives in /usr/bin, not /bin.
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('aircrack'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithUsrBinary('aircrack'), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, ['-b', '00:11'], NO_FLAGS);

    expect(textLines(result)).toEqual(['-b,00:11']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('resolves an admin daemon from /usr/sbin (sshd) when it is in neither /bin nor /usr/bin', async () => {
    // sshd is a system daemon: it lives in /usr/sbin only. Proves the search
    // path reaches /usr/sbin — without it, sshd would report command-not-found.
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('sshd'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithSbinBinary('sshd'), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, ['2222'], NO_FLAGS);

    expect(textLines(result)).toEqual(['2222']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  // Every apt binary maps to the package name shown in the install hint. Driving
  // each through the user-visible message kills every catalog string literal
  // without exposing the internal map. The pairs ARE the spec (legacy parity).
  const APT_HINT_PAIRS: readonly (readonly [string, string])[] = [
    ['nmap', 'nmap'],
    ['john', 'john'],
    ['nc', 'netcat'],
    ['ftp', 'ftp'],
    ['msfconsole', 'metasploit'],
    ['airmon', 'aircrack'],
    ['airdump', 'aircrack'],
    ['aircrack', 'aircrack'],
    ['gpg', 'gpg'],
    ['node', 'node'],
    ['hydra', 'hydra'],
    ['gobuster', 'gobuster'],
    ['snmpwalk', 'snmp'],
    ['snmpset', 'snmp'],
    ['mysql', 'mysql'],
    ['rediscli', 'redis-tools'],
    ['lynx', 'lynx'],
    ['apache2', 'apache2'],
    ['nginx', 'nginx'],
  ];

  it.each(APT_HINT_PAIRS)(
    'hints `apt install %s` when the apt tool resolving to it (%s) is missing',
    async (binary, pkg) => {
      const wrapped = wrapWithBinaryCheck(echoArgsCommand(binary));
      const env = mockCommandEnv({
        fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
      });

      const result = await wrapped.execute(env, [], NO_FLAGS);

      expect(errorLines(result)).toEqual([
        `bash: ${binary}: command not found. Install with: apt install ${pkg}`,
      ]);
      expect(result.kind === 'sync' && result.exitCode).toBe(127);
    },
  );

  it('uses the plain not-found message for a name with no apt package', async () => {
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('frobnicate'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    // No "Install with" suffix — frobnicate is not a known package.
    expect(errorLines(result)).toEqual(['bash: frobnicate: command not found']);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('does not append a hint for a system utility that lives in /bin (ls)', async () => {
    // ls is a /bin system util, not an apt package — a missing /bin/ls is a
    // broken system, not something `apt install` fixes.
    const wrapped = wrapWithBinaryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
  });
});

/** A root-owned, non-executable shared-library stub file. */
const libFile = () =>
  buildFile('\x7fELF-lib', {
    owner: 'root',
    perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  });

/** Build a tree whose `/lib` holds the named `<lib>.so` stub files. */
const treeWithLibs = (libNames: readonly string[]) =>
  buildDirectory({
    lib: buildDirectory(Object.fromEntries(libNames.map((name) => [`${name}.so`, libFile()]))),
  });

describe('wrapWithLibraryCheck — library dependency gating (slice 3)', () => {
  it('runs a command when every linked library is present', async () => {
    // ls links libpcre; with /lib/libpcre.so present it runs normally.
    const wrapped = wrapWithLibraryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithLibs(['libpcre']), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, ['x', 'y'], NO_FLAGS);

    expect(textLines(result)).toEqual(['x,y']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('emits the canonical dynamic-linker error (exit 127) when a linked .so is missing', async () => {
    const wrapped = wrapWithLibraryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ lib: buildDirectory({}) }), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual([
      'ls: error while loading shared libraries: libpcre.so: cannot open shared object file: No such file or directory',
    ]);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('runs a command with no library dependencies regardless of /lib (opt-in check)', async () => {
    // mkdir is NOT in the manifest — it must run even with /lib emptied.
    const wrapped = wrapWithLibraryCheck(echoArgsCommand('mkdir'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ lib: buildDirectory({}) }), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, ['newdir'], NO_FLAGS);

    expect(textLines(result)).toEqual(['newdir']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });

  it('reports the FIRST missing library in dependency order (su → libpam before libcrypt)', async () => {
    // su links [libpam, libcrypt]. With only libcrypt present, libpam is named.
    const wrapped = wrapWithLibraryCheck(echoArgsCommand('su'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithLibs(['libcrypt']), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual([
      'su: error while loading shared libraries: libpam.so: cannot open shared object file: No such file or directory',
    ]);
  });

  it('checks every dependency, not just the first (su → libcrypt when libpam is present)', async () => {
    const wrapped = wrapWithLibraryCheck(echoArgsCommand('su'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(treeWithLibs(['libpam']), { userType: 'user' }),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual([
      'su: error while loading shared libraries: libcrypt.so: cannot open shared object file: No such file or directory',
    ]);
  });

  it('treats a directory named like the .so as a missing library', async () => {
    const wrapped = wrapWithLibraryCheck(echoArgsCommand('ls'));
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(
        buildDirectory({ lib: buildDirectory({ 'libpcre.so': buildDirectory({}) }) }),
        { userType: 'user' },
      ),
    });

    const result = await wrapped.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual([
      'ls: error while loading shared libraries: libpcre.so: cannot open shared object file: No such file or directory',
    ]);
  });
});

describe('commandRegistry — binary + library gating composed (slice 3)', () => {
  it('reports the linker error when the binary is present but a linked library is missing', async () => {
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const tree = buildDirectory({
      bin: buildDirectory({
        ls: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
      }),
      lib: buildDirectory({}), // /bin/ls present, libpcre.so missing
      tmp: buildDirectory({}),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual([
      'ls: error while loading shared libraries: libpcre.so: cannot open shared object file: No such file or directory',
    ]);
    expect(result.kind === 'sync' && result.exitCode).toBe(127);
  });

  it('prioritises command-not-found over the linker error when the binary is absent', async () => {
    // Binary check is outermost: no /bin/ls AND no libpcre.so → not-found wins.
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ lib: buildDirectory({}), tmp: buildDirectory({}) }), {
        userType: 'user',
        cwd: asAbsPath('/tmp'),
      }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(errorLines(result)).toEqual(['bash: ls: command not found']);
  });

  it('runs ls when both its binary and its libpcre library are present', async () => {
    const ls = commandRegistry.get('ls');
    if (ls === undefined) throw new Error('ls not registered');
    const tree = buildDirectory({
      bin: buildDirectory({
        ls: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
      }),
      lib: buildDirectory({ 'libpcre.so': libFile() }),
      tmp: buildDirectory({ 'a.txt': buildFile('x', { owner: 'alice' }) }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(textLines(result)).toEqual(['a.txt']);
    expect(result.kind === 'sync' && result.exitCode).toBe(0);
  });
});
