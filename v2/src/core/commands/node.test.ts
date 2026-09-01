import { describe, expect, it, vi } from 'vitest';
import { node } from './node';
import { man } from './man';
import { commandRegistry } from './registry';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { collectStageOutput } from '../shell/runLine';
import { asAbsPath } from '../types';
import type { UserType } from '../types';
import type {
  CommandEnv,
  CommandResult,
  PatchApi,
  PatchResult,
  TerminalLine,
} from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** What a race reports when the thing it was waiting for never arrived. A distinct
 *  value rather than a rejection, so a test that times out fails on the assertion
 *  it meant to make instead of on an error nobody wrote. */
const TIMED_OUT = Symbol('timed out');

/** Await something that is only allowed a short while to happen. Used where the
 *  claim is that output arrives BEFORE the script finishes: the script deliberately
 *  never finishes, so without a bound the test would hang instead of failing. */
const within = <Value>(pending: Promise<Value>, timeoutMs = 200): Promise<Value | symbol> => {
  let cancel: () => void = () => undefined;
  const expiry = new Promise<symbol>((resolve) => {
    const handle = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    cancel = () => clearTimeout(handle);
  });
  return Promise.race([pending, expiry]).finally(cancel);
};

/** Everything a result produced, in order, plus the code it ended on. `node`
 *  streams, so a test reads it the way the terminal does — by draining it —
 *  rather than by reaching for an array only a sync result has. */
const drain = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly TerminalLine[]; readonly exitCode: number }> => {
  if (result.kind === 'mode_change') {
    return { lines: [], exitCode: 0 };
  }
  if (result.kind === 'sync') {
    return { lines: result.lines, exitCode: result.exitCode };
  }
  const collected: TerminalLine[] = [];
  for await (const line of result.lines) {
    collected.push(line);
  }
  return { lines: collected, exitCode: await result.exitCode() };
};

/** A home tree holding one script owned by alice. The factory's default file
 *  perms are exactly what `nano` stamps — read for root and the owner tier,
 *  `execute: ['root']` — so every script here is one a `user` may read but not
 *  execute, which is the case `node` must still run. */
const envWithScript = (fileName: string, source: string): CommandEnv =>
  mockCommandEnv({
    fs: mockFsViewFromTree(
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            { [fileName]: buildFile(source, { owner: 'alice' }) },
            { owner: 'alice' },
          ),
        }),
      }),
      { userType: 'user', cwd: asAbsPath('/home/alice') },
    ),
    session: mockSession({ username: 'alice', userType: 'user' }),
  });

/** A tree with `cat` genuinely installed — the binary AND the libpcre it links,
 *  because a script reaches it through the REAL registry and so has to satisfy
 *  both gates a typed `cat` satisfies — plus one readable file and one script.
 *  For the cases that need an inner command with something real to say. */
const envWithCatAndScript = (source: string): CommandEnv =>
  mockCommandEnv({
    fs: mockFsViewFromTree(
      buildDirectory({
        bin: buildDirectory({
          cat: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
        }),
        lib: buildDirectory({ 'libpcre.so': buildFile('') }),
        home: buildDirectory({
          alice: buildDirectory(
            {
              'notes.txt': buildFile('port 22 is open\n', { owner: 'alice' }),
              'run.js': buildFile(source, { owner: 'alice' }),
            },
            { owner: 'alice' },
          ),
        }),
      }),
      { userType: 'user', cwd: asAbsPath('/home/alice') },
    ),
    session: mockSession({ username: 'alice', userType: 'user' }),
  });

const READABLE = 'port 22 is open\n';

/** The home a script sits in: one file it may read, one it may not, a directory
 *  to write into — and a recorded `patches.write`, because a script that keeps
 *  what it found is a script whose write IS the observable.
 *
 *  NOTHING is installed here, deliberately. A tree with `cat` on it could not
 *  tell a working `fs.readFile` from a script that shelled out to a command. */
const homeTree = (source: string, notes: string) =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        {
          'notes.txt': buildFile(notes, { owner: 'alice' }),
          // World-readable so one tree serves a guest session too. `node`
          // gates on READ and slice 1 owns that gate; nothing here is
          // testing it, and a script a guest cannot open would test it by
          // accident instead of testing the tier a WRITE runs at.
          'sweep.js': buildFile(source, {
            owner: 'alice',
            perms: { read: ['root', 'user', 'guest'] },
          }),
          // Root-owned, so the factory's default perms make it unreadable and
          // unwritable to a `user` session — the permission arm, without a
          // hand-written perms literal that could drift from the walker.
          'root-only.txt': buildFile('a hash alice has to work for'),
          // Writable but NOT readable — the one shape an append must refuse
          // rather than treat as empty, because treating it as empty would
          // REPLACE a file whose contents it was never allowed to see.
          'write-only.txt': buildFile('evidence alice may not read', {
            owner: 'alice',
            perms: { read: ['root'], write: ['root', 'user'] },
          }),
          loot: buildDirectory({}, { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const scriptEnv = (
  source: string,
  options: {
    readonly writeResult?: PatchResult;
    readonly userType?: UserType;
    /** What `notes.txt` says on the MACHINE, as opposed to in the tree this
     *  shell is holding — i.e. what a fellow occupant wrote after this client
     *  pulled its copy. Absent, a reload finds what the client already has. */
    readonly notesOnReload?: string;
  } = {},
): { readonly env: CommandEnv; readonly writeFn: ReturnType<typeof vi.fn> } => {
  const writeFn = vi.fn<PatchApi['write']>(async () => options.writeResult ?? { ok: true });
  const notesOnReload = options.notesOnReload;
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(homeTree(source, READABLE), {
      userType: options.userType ?? 'user',
      cwd: asAbsPath('/home/alice'),
      ...(notesOnReload === undefined
        ? {}
        : { onReload: async () => homeTree(source, notesOnReload) }),
    }),
    session: mockSession({ username: 'alice', userType: options.userType ?? 'user' }),
    patches: { write: writeFn, remove: async () => ({ ok: true }), mkdir: async () => ({ ok: true }) },
  });
  return { env, writeFn };
};

describe('node', () => {
  it('puts a line on the terminal before the script has finished', async () => {
    // The script never settles. So the only way its first line can be observed at
    // all is if output leaves `node` as it is produced — a run that collects
    // everything and reports at the end can never satisfy this, however correct
    // the lines it eventually reports. That is the whole of this slice, and it is
    // the one claim a collect-then-report implementation cannot fake.
    const env = envWithScript(
      'slow.js',
      ["console.log('first')", 'await new Promise(() => {})', "console.log('unreachable')", ''].join(
        '\n',
      ),
    );

    const result = await within(node.execute(env, ['slow.js'], NO_FLAGS));

    expect(result).not.toBe(TIMED_OUT);
    if (typeof result === 'symbol') return;
    expect(result.kind).toBe('async');
    if (result.kind !== 'async') return;
    const lines = result.lines[Symbol.asyncIterator]();
    const first = await within(lines.next());

    expect(first).toEqual({ done: false, value: { kind: 'text', content: 'first' } });
    await lines.return?.(undefined);
  });

  it("puts an inner command's stderr on the terminal before the script has finished", async () => {
    // The script's own voice and a command's passthrough travel the same queue,
    // so a fast path added for one of them later would break the other's order.
    // This pins that they share a channel, not merely that they end up sorted.
    const env = envWithCatAndScript(
      [
        "console.log('before')",
        "await cat('missing.txt')",
        'await new Promise(() => {})',
        '',
      ].join('\n'),
    );

    const result = await within(node.execute(env, ['run.js'], NO_FLAGS));

    expect(result).not.toBe(TIMED_OUT);
    if (typeof result === 'symbol') return;
    if (result.kind !== 'async') return;
    const lines = result.lines[Symbol.asyncIterator]();
    const first = await within(lines.next());
    const second = await within(lines.next());

    expect(first).toEqual({ done: false, value: { kind: 'text', content: 'before' } });
    expect(second).toEqual({
      done: false,
      value: { kind: 'error', content: 'cat: missing.txt: No such file or directory' },
    });
    await lines.return?.(undefined);
  });

  it('gives a pipe the same stdout it always gave, now that it arrives in pieces', async () => {
    // `collectStageOutput` is what a pipe stage puts a command through, and the
    // branch `node` takes through it has changed: it is drained now rather than
    // read off an array. A redirect uses the same split, so `> out.txt` rides on
    // this too. Nothing paints here, which is correct — a piped stage's stdout
    // belongs to the next command, not to the screen.
    const env = envWithScript(
      'pipe.js',
      ["console.log('22/tcp open')", "console.error('warning')", "console.log('80/tcp open')", ''].join(
        '\n',
      ),
    );

    const staged = await collectStageOutput(await node.execute(env, ['pipe.js'], NO_FLAGS));

    expect(staged.stdout).toEqual(['22/tcp open', '80/tcp open']);
    expect(staged.passthrough).toEqual([{ kind: 'error', content: 'warning' }]);
    expect(staged.exitCode).toBe(0);
  });

  it("keeps an inner command's stdout off the terminal — a call captures, it does not print", async () => {
    // The reason a script can be written at all: `await nmap(gw)` hands the scan
    // BACK, and the script decides whether any of it is worth showing. A change
    // that painted it would read like a fix and would silently make every
    // capturing script print twice.
    const env = envWithCatAndScript(
      ["const out = await cat('notes.txt')", "console.log('got:' + out.length)", ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['run.js'], NO_FLAGS));

    expect(result.lines).toEqual([{ kind: 'text', content: 'got:1' }]);
    expect(result.exitCode).toBe(0);
  });

  it('prints what a script logs and exits 0', async () => {
    const env = envWithScript('hello.js', "console.log('hello')\n");

    const result = await drain(await node.execute(env, ['hello.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['hello']);
  });

  it('gives log, error and debug their own line kinds', async () => {
    const env = envWithScript(
      'sinks.js',
      ["console.log('out')", "console.error('bad')", "console.debug('aside')", ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['sinks.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      { kind: 'text', content: 'out' },
      { kind: 'error', content: 'bad' },
      { kind: 'dim', content: 'aside' },
    ]);
  });

  it('joins multiple arguments with a single space', async () => {
    const env = envWithScript('args.js', "console.log('host:', '10.0.0.5')\n");

    const result = await drain(await node.execute(env, ['args.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['host: 10.0.0.5']);
  });

  it('renders an object argument as JSON rather than [object Object]', async () => {
    const env = envWithScript('object.js', 'console.log({ port: 22, open: true })\n');

    const result = await drain(await node.execute(env, ['object.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['{"port":22,"open":true}']);
  });

  it('renders an array of strings one element per line', async () => {
    // What makes `console.log(await nmap(…))` read as captured output rather
    // than as a JSON array once commands become callable.
    const env = envWithScript('list.js', "console.log(['22/tcp open', '80/tcp open'])\n");

    const result = await drain(await node.execute(env, ['list.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['22/tcp open', '80/tcp open']);
  });

  it('renders a mixed array as JSON, since only an all-string array is output', async () => {
    // The one-per-line rule exists so captured command output reads as lines;
    // an array holding anything else is data, and printing it as lines would
    // lose the distinction between an element and a line break.
    const env = envWithScript('mixed.js', "console.log(['open', 22])\n");

    const result = await drain(await node.execute(env, ['mixed.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['["open",22]']);
  });

  it('prints undefined rather than nothing', async () => {
    // JSON has no undefined, so a value that does not survive stringifying
    // falls back to its own text — a script printing an unset variable must
    // not look like a script that printed a blank line.
    const env = envWithScript('unset.js', 'console.log(undefined)\n');

    const result = await drain(await node.execute(env, ['unset.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['undefined']);
  });

  it('reports a thrown error, exits 1, and keeps what the script already printed', async () => {
    const env = envWithScript(
      'boom.js',
      ["console.log('before')", "throw new Error('target unreachable')", ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['boom.js'], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      { kind: 'text', content: 'before' },
      { kind: 'error', content: 'Error: target unreachable' },
    ]);
  });

  it('reports a syntax error the same way rather than taking the terminal down', async () => {
    const env = envWithScript('broken.js', "console.log('unclosed'\n");

    const result = await drain(await node.execute(env, ['broken.js'], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toHaveLength(1);
    expect(errorLines(result)[0]).toMatch(/^SyntaxError: /);
  });

  it('lets a script shadow an injected name with const', async () => {
    // Injected names reach the script as the sandbox function's own
    // parameters, so an unwrapped body would answer a top-level
    // `const console` with a redeclaration SyntaxError and never run a line of
    // the script. Pinned while one name is injected, because a name per
    // command follows and a player's `const cat = …` must not kill a script.
    const env = envWithScript(
      'shadow.js',
      ['const console = { log: () => undefined }', "console.log('swallowed')", ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['shadow.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('runs a script the session may read but may not execute', async () => {
    // The execute bit is deliberately not consulted. `nano` stamps
    // execute: ['root'] on everything a user writes and the game has no
    // chmod, so gating on it would stop a player running the script they just
    // wrote — and real node opens a script for reading, not for execution.
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'own.js': buildFile("console.log('mine')\n", {
              owner: 'alice',
              perms: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
            }),
          },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
      session: mockSession({ username: 'alice', userType: 'user' }),
    });

    const result = await drain(await node.execute(env, ['own.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['mine']);
  });

  it('refuses a script the session cannot read', async () => {
    const tree = buildDirectory({
      root: buildDirectory(
        { 'secret.js': buildFile("console.log('classified')\n", { owner: 'root' }) },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({ fs: mockFsViewFromTree(tree, { userType: 'user' }) });

    const result = await drain(await node.execute(env, ['/root/secret.js'], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: /root/secret.js: Permission denied']);
  });

  it('reports a missing file operand', async () => {
    const result = await drain(await node.execute(mockCommandEnv(), [], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: missing file operand']);
  });

  it('reports a script that is not there', async () => {
    const env = mockCommandEnv({ fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }) });

    const result = await drain(await node.execute(env, ['/root/gone.js'], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: /root/gone.js: No such file or directory']);
  });

  it('reports a directory given where a script was expected', async () => {
    const tree = buildDirectory({ etc: buildDirectory({}, { owner: 'root' }) });
    const env = mockCommandEnv({ fs: mockFsViewFromTree(tree, { userType: 'user' }) });

    const result = await drain(await node.execute(env, ['/etc'], NO_FLAGS));

    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: /etc: Is a directory']);
  });

  it('treats an empty script as a no-op that exits 0', async () => {
    const env = envWithScript('empty.js', '   \n\n');

    const result = await drain(await node.execute(env, ['empty.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('lets a script await', async () => {
    // There is one mode and it is async, so `await` never has to be detected
    // in the source or unlocked by a second execution path.
    const env = envWithScript(
      'await.js',
      ["const answer = await Promise.resolve('resolved')", 'console.log(answer)', ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['await.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['resolved']);
  });

  it('is registered, so a box without the binary hints at the install', async () => {
    // Registration is what turns the bare not-found an unknown command gets
    // into the apt hint — proving `node` reached the registry, not just that
    // the module exports it. `apt install node` has laid down /usr/bin/node
    // since the connectivity arc with nothing behind it; this is the wiring.
    const gated = commandRegistry.get('node');
    if (gated === undefined) throw new Error('node not registered');

    const result = await gated.execute(mockCommandEnv(), ['hello.js'], NO_FLAGS);

    expect(result.kind === 'sync' && result.exitCode).toBe(127);
    expect(result.kind === 'sync' && result.lines[0]?.content).toBe(
      'bash: node: command not found. Install with: apt install node',
    );
  });

  it('lets a script call a command and hands back what the prompt would show', async () => {
    const env = envWithScript(
      'run.js',
      ["const out = await echo('one', 'two')", "console.log(out.length + ':' + out[0])", ''].join(
        '\n',
      ),
    );

    const result = await drain(await node.execute(env, ['run.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    // One line, holding both positionals joined the way `echo one two` joins
    // them at the prompt — so the call carried the arguments AND the answer
    // came back as the array a script can index.
    expect(textLines(result)).toEqual(['1:one two']);
  });

  it('reaches a hyphenated command by its camelCase name', async () => {
    // A binding is a formal PARAMETER of the sandbox function, and `redis-cli`
    // there is a SyntaxError that would kill every script in the game — so the
    // identifier is derived from the name rather than being the name.
    const env = envWithScript(
      'names.js',
      "console.log([typeof redisCli, typeof aircrackNg, typeof newGame, typeof nmap].join(','))\n",
    );

    const result = await drain(await node.execute(env, ['names.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['function,function,function,function']);
  });

  it("sends an inner command's stderr to the terminal and lets the script carry on", async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(
        buildDirectory({
          bin: buildDirectory({
            cat: buildFile('', { owner: 'root', perms: { execute: ['root', 'user', 'guest'] } }),
          }),
          // `cat` links libpcre — the script reaches it through the REAL
          // registry, so both gates a typed `cat` passes have to be satisfied.
          lib: buildDirectory({ 'libpcre.so': buildFile('') }),
          home: buildDirectory({
            alice: buildDirectory(
              {
                'run.js': buildFile(
                  [
                    "console.log('before')",
                    "const out = await cat('missing.txt')",
                    "console.log('after:' + out.exitCode + ':' + out.length)",
                    '',
                  ].join('\n'),
                  { owner: 'alice' },
                ),
              },
              { owner: 'alice' },
            ),
          }),
        }),
        { userType: 'user', cwd: asAbsPath('/home/alice') },
      ),
      session: mockSession({ username: 'alice', userType: 'user' }),
    });

    const result = await drain(await node.execute(env, ['run.js'], NO_FLAGS));

    // The error line is the TERMINAL's, in the order it happened, and is absent
    // from what the call handed back — the same split the pipeline makes, where
    // only `text` is stdout. A nonzero exit is data, not an exception, so the
    // script runs on and `node` itself succeeds.
    expect(result.lines).toEqual([
      { kind: 'text', content: 'before' },
      { kind: 'error', content: 'cat: missing.txt: No such file or directory' },
      { kind: 'text', content: 'after:1:0' },
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('prints a refusal in the words the prompt would use, and stops there', async () => {
    const env = envWithScript(
      'hop.js',
      ["console.log('before')", "await ssh('root@10.0.0.5', 'pw')", "console.log('never')", ''].join(
        '\n',
      ),
    );

    const result = await drain(await node.execute(env, ['hop.js'], NO_FLAGS));

    // Bare — no `Error:` in front of it. The shell is speaking, and it says at
    // a script what it would have said at the prompt.
    expect(result.lines).toEqual([
      { kind: 'text', content: 'before' },
      { kind: 'error', content: 'ssh: cannot be run from a script' },
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('answers a command the box has not installed exactly as the prompt would', async () => {
    const env = envWithScript(
      'scan.js',
      ["const out = await nmap('10.0.0.5')", "console.log('exit:' + out.exitCode)", ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['scan.js'], NO_FLAGS));

    // A script gets the same answer, and the same apt hint, as a player who
    // typed it — a script grants no capability, it removes typing.
    expect(result.lines).toEqual([
      {
        kind: 'error',
        content: 'bash: nmap: command not found. Install with: apt install nmap',
      },
      { kind: 'text', content: 'exit:127' },
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('lets a script shadow a command name with its own binding', async () => {
    // The block wrap, now carrying every command in the registry: without it a
    // top-level `const nmap = …` would be a redeclaration SyntaxError killing
    // the script before its first line, for a reason the player cannot see.
    const env = envWithScript('shadow.js', ["const nmap = 'mine'", 'console.log(nmap)', ''].join('\n'));

    const result = await drain(await node.execute(env, ['shadow.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['mine']);
  });

  it('carries a manual and sits with the filesystem commands in help', async () => {
    expect(commandRegistry.get('node')?.category).toBe('filesystem');

    const result = await drain(await man.execute(mockCommandEnv(), ['node'], NO_FLAGS));

    expect(result.exitCode).toBe(0);

    // Whole rendered lines, not words of them: the manual is the entire
    // discoverability story for scripting until the tutorials land, so what a
    // player reads is worth pinning.
    const contents = result.lines.map((line) => line.content);
    expect(contents).toContain('NODE(1)');
    expect(contents).toContain('    node - Run a JavaScript file');
    expect(contents).toContain('    node [script]');
    expect(contents).toContain('    script (optional)');
    expect(contents).toContain('        Path to the JavaScript file to run');
    expect(contents).toContain('    node hello.js');
    expect(contents).toContain('        Run a script in the current directory');
    expect(contents).toContain('    node /root/sweep.js | grep OPEN');
    expect(contents).toContain("        Filter a script's output like any other command");
    expect(contents.join('\n')).toContain('console.log writes normal output');

    // The manual is the whole API surface until the tutorials land, so it has
    // to carry what a script can now DO — and say plainly what it still cannot.
    const description = contents.join('\n');
    expect(description).toContain('await');
    expect(description).toContain('.exitCode');
    expect(description).toContain('redisCli');
    expect(description).toContain("{'-p': 2222}");
    expect(description).toContain('await fs.readFile');
    expect(description).toContain('await fs.appendFile');
    // What a failure DOES is the half a player cannot discover by trying it once
    // and getting away with it, so the page has to say it.
    expect(description).toContain('throws');
    expect(description).toContain('cannot yet take arguments of their own or sleep');
    expect(contents).toContain("    const out = await nmap('10.0.0.5')");
    expect(contents).toContain("        Inside a script: scan a host and keep the scan's lines");
    expect(contents).toContain("    await fs.appendFile('/root/loot.txt', out)");
    expect(contents).toContain(
      '        Inside a script: add what this host gave up to the report so far',
    );
  });
});

describe("a script's filesystem", () => {
  it("hands a script a file it may read, resolved against the script's own cwd", async () => {
    // The path is relative, so this pins the resolution too: a script says
    // `notes.txt` and means the directory it is sitting in, exactly as `cat` does
    // at that prompt.
    //
    // The script stringifies what it got rather than printing it, because the
    // claim is about the STRING and printing would blur it: a terminal line
    // cannot hold a newline, so `console.log` of a file ending in one paints an
    // extra empty line. That is console's business. This asserts what `readFile`
    // handed over — the file whole, trailing newline included, nothing trimmed.
    const { env } = scriptEnv(
      "console.log(JSON.stringify(await fs.readFile('notes.txt')))",
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual([JSON.stringify(READABLE)]);
    expect(result.exitCode).toBe(0);
  });

  it('says what node already says when a script cannot read a file, in all three ways', async () => {
    // Not a new vocabulary: these are the same three sentences `node` prints when
    // it cannot open the SCRIPT, from the same helper, because a player who
    // mistypes a path at the prompt and one who mistypes it inside their script
    // have made one mistake and should hear one answer.
    //
    // The path echoed back is the raw one the script passed, not the resolved
    // absolute — again matching what `node` does with its own argument.
    const { env } = scriptEnv(
      [
        "for (const path of ['missing.txt', 'loot', 'root-only.txt']) {",
        '  try {',
        '    await fs.readFile(path)',
        '  } catch (failure) {',
        '    console.log(failure.message)',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual([
      'node: missing.txt: No such file or directory',
      'node: loot: Is a directory',
      'node: root-only.txt: Permission denied',
    ]);
    // Caught is handled: a script that answers its own failure is a script that
    // succeeded, which is what decision 6 means by not shipping an `fs.exists`.
    expect(result.exitCode).toBe(0);
  });

  it('stops a script on an uncaught read, prints the reason bare, and keeps what came first', async () => {
    // Bare is the claim. A refusal at the prompt reads
    // `node: x: No such file or directory`, and the same sentence dressed as
    // `Error: node: x: …` would tell the player their SCRIPT went wrong when what
    // went wrong is the file — so the throw is tagged the way a shell refusal is.
    const { env } = scriptEnv(
      ["console.log('before')", "await fs.readFile('missing.txt')", "console.log('unreachable')", ''].join(
        '\n',
      ),
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['before']);
    expect(errorLines(result)).toEqual(['node: missing.txt: No such file or directory']);
    expect(result.exitCode).toBe(1);
  });

  it('creates a file the script asks for, and stamps it new', async () => {
    // `isNew` is not decoration: the server stamps the row `is_new: true` so a
    // later `rm` deletes it outright instead of leaving a tombstone. A script
    // creating a loot file has to report it exactly as the `>` redirect does.
    const { env, writeFn } = scriptEnv("await fs.writeFile('loot/hosts.txt', 'one line')");

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/loot/hosts.txt'), 'one line', {
      isNew: true,
    });
  });

  it("saves a command's captured lines as lines, the way `>` writes them", async () => {
    // Two things at once, and both would look fine in a passing suite that
    // asserted neither. The array a call hands back carries `.exitCode`, so a
    // formatter reaching for JSON would save `{"0":"…","exitCode":0}` instead of
    // the scan — and the join gains no trailing newline, because `>` writes
    // `stdout.join('\n')` and a file the player redirected into and one their
    // script saved must not differ by a byte.
    const { env, writeFn } = scriptEnv(
      [
        "const found = Object.assign(['192.168.0.1 up', '192.168.0.2 up'], { exitCode: 0 })",
        "await fs.writeFile('loot/hosts.txt', found)",
        '',
      ].join('\n'),
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledWith(
      asAbsPath('/home/alice/loot/hosts.txt'),
      '192.168.0.1 up\n192.168.0.2 up',
      { isNew: true },
    );
  });

  it('saves any other value exactly as the script would have printed it', async () => {
    // One formatter for printing and saving. Two would mean a sweep whose
    // console said one thing and whose loot file said another.
    const { env, writeFn } = scriptEnv(
      "await fs.writeFile('loot/found.json', { host: '10.0.0.5', port: 22 })",
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledWith(
      asAbsPath('/home/alice/loot/found.json'),
      '{"host":"10.0.0.5","port":22}',
      { isNew: true },
    );
  });

  it('overwrites a file that already existed without restamping it as new', async () => {
    // `is_new` decides whether a later `rm` deletes the row or leaves a
    // tombstone, so an overwrite must not claim to have created anything.
    const { env, writeFn } = scriptEnv("await fs.writeFile('notes.txt', 'replaced')");

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledWith(asAbsPath('/home/alice/notes.txt'), 'replaced', {
      isNew: false,
    });
  });

  it('refuses a write the same three ways the redirect refuses one, and writes nothing', async () => {
    // The rule is shared with `>` on purpose — a path one door refuses and the
    // other accepts is a hole, and this is tier permissions. Only the prefix
    // differs, because the player is talking to `node`, not to bash.
    const { env, writeFn } = scriptEnv(
      [
        "for (const path of ['loot', 'nowhere/hosts.txt', 'root-only.txt']) {",
        '  try {',
        "    await fs.writeFile(path, 'x')",
        '  } catch (failure) {',
        '    console.log(failure.message)',
        '  }',
        '}',
        '',
      ].join('\n'),
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual([
      'node: loot: Is a directory',
      'node: nowhere/hosts.txt: No such file or directory',
      'node: root-only.txt: Permission denied',
    ]);
    // A refused write must never reach the journal. Reporting the refusal and
    // writing anyway would be the worst of both.
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('adds to the end of a file, and creates one that was never there', async () => {
    // The shell has no `>>` at all, so this is the first append in the game and
    // the only way a sweep can survive its own second run.
    //
    // Nothing inserts a separator: the existing file's own trailing newline is
    // what puts the new line on its own row, exactly as real `appendFile`
    // behaves. A file with no trailing newline runs on, and that is the
    // script's business — the manual says so rather than the seam guessing.
    const { env, writeFn } = scriptEnv(
      [
        "await fs.appendFile('notes.txt', 'port 443 is open')",
        "await fs.appendFile('loot/fresh.txt', 'first line')",
        '',
      ].join('\n'),
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenNthCalledWith(
      1,
      asAbsPath('/home/alice/notes.txt'),
      'port 22 is open\nport 443 is open',
      { isNew: false, baseContent: READABLE },
    );
    // An absent file is the ORDINARY first-line case, not a failure — and it
    // names the empty string as its base, which is how the server tells "expected
    // nothing and found nothing" from "expected nothing and someone got there".
    expect(writeFn).toHaveBeenNthCalledWith(
      2,
      asAbsPath('/home/alice/loot/fresh.txt'),
      'first line',
      { isNew: true, baseContent: '' },
    );
  });

  it('composes an append against the machine as it stands, not the tree this shell holds', async () => {
    // This is the defect `FsView.reload()` exists for, and an append is the
    // shape that walks straight into it. A whole-file write composed from the
    // cached tree does not merely MISS a write that landed after this client
    // pulled its copy — it REVERTS it. On any box a fellow occupant can reach,
    // a sweep adding one line per host would quietly erase their edit.
    //
    // So the line an occupant added has to survive, and the base the write
    // names has to be what the MACHINE holds, not what this shell remembers.
    const OCCUPIED = 'port 22 is open\nsomebody else was here\n';
    const { env, writeFn } = scriptEnv("await fs.appendFile('notes.txt', 'mine')", {
      notesOnReload: OCCUPIED,
    });

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(result.exitCode).toBe(0);
    expect(writeFn).toHaveBeenCalledWith(
      asAbsPath('/home/alice/notes.txt'),
      `${OCCUPIED}mine`,
      { isNew: false, baseContent: OCCUPIED },
    );
  });

  it('refuses an append rather than reverting a write that landed underneath it', async () => {
    // The append names the base it composed against, so a write that lands in
    // the window between the reload and this write is caught by the server
    // instead of being flattened. On the script's own box nothing else is
    // writing and this never fires; on a shared one it is the difference
    // between a sweep and an accident.
    //
    // Loud, deliberately. A last-writer-wins append would be quieter and would
    // eat the other edit — and the script can catch this and retry, which it
    // could not do with an edit that was already gone.
    const { env } = scriptEnv(
      [
        "console.log('sweeping')",
        "await fs.appendFile('notes.txt', 'mine')",
        "console.log('unreachable')",
        '',
      ].join('\n'),
      { writeResult: { ok: false, error: 'modified_since_open' } },
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['sweeping']);
    expect(errorLines(result)).toEqual(['node: notes.txt: File changed on disk']);
    expect(result.exitCode).toBe(1);
  });

  it('does not let a script believe a write the journal refused', async () => {
    // A round trip that never completed is not a saved file. Returning quietly
    // would leave the script writing more of a report nobody will ever read.
    const { env } = scriptEnv("await fs.writeFile('loot/hosts.txt', 'x')", {
      writeResult: { ok: false, error: 'network_error' },
    });

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(errorLines(result)).toEqual(['node: loot/hosts.txt: I/O error']);
    expect(result.exitCode).toBe(1);
  });

  it("writes at the session's own tier and no higher", async () => {
    // The invariant that IS this feature's security posture: a script can do
    // exactly what the player could type at that prompt, and nothing more.
    // `node` grants no capability — it removes typing. A guest is refused the
    // same directory a guest is refused at the prompt, and no write is
    // attempted before the refusal.
    const { env, writeFn } = scriptEnv(
      [
        "for (const attempt of [() => fs.writeFile('loot/hosts.txt', 'x'),",
        "                       () => fs.appendFile('notes.txt', 'x')]) {",
        '  try {',
        '    await attempt()',
        '  } catch (failure) {',
        '    console.log(failure.message)',
        '  }',
        '}',
        '',
      ].join('\n'),
      { userType: 'guest' },
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual([
      'node: loot/hosts.txt: Permission denied',
      'node: notes.txt: Permission denied',
    ]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("lets a script declare its own `fs` without taking the script down", async () => {
    // An injected name is a formal PARAMETER of the sandbox function, so a
    // top-level `const fs` in the body itself would be a redeclaration
    // SyntaxError that kills the script before its first line — for a reason
    // the player cannot see. The block wrap makes it an ordinary legal shadow.
    const { env } = scriptEnv(
      ["const fs = 'mine'", 'console.log(fs)', ''].join('\n'),
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(textLines(result)).toEqual(['mine']);
    expect(result.exitCode).toBe(0);
  });

  it('refuses to append to a file it may write but may not read', async () => {
    // The write gate and the read gate are separate lists, so "I can write here"
    // does not imply "I can see what is here". An append that shrugged and
    // treated an unreadable file as empty would not add a line to it — it would
    // TRUNCATE it to that line, destroying content the player was never even
    // allowed to look at. Silent data loss, from a call that reported success.
    const { env, writeFn } = scriptEnv(
      "await fs.appendFile('write-only.txt', 'mine')",
    );

    const result = await drain(await node.execute(env, ['sweep.js'], NO_FLAGS));

    expect(errorLines(result)).toEqual(['node: write-only.txt: Permission denied']);
    expect(result.exitCode).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });
});
