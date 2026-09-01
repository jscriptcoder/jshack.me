import { describe, expect, it } from 'vitest';
import { node } from './node';
import { man } from './man';
import { commandRegistry } from './registry';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { CommandEnv, TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

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

describe('node', () => {
  it('prints what a script logs and exits 0', async () => {
    const env = envWithScript('hello.js', "console.log('hello')\n");

    const result = await node.execute(env, ['hello.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['hello']);
  });

  it('gives log, error and debug their own line kinds', async () => {
    const env = envWithScript(
      'sinks.js',
      ["console.log('out')", "console.error('bad')", "console.debug('aside')", ''].join('\n'),
    );

    const result = await node.execute(env, ['sinks.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      { kind: 'text', content: 'out' },
      { kind: 'error', content: 'bad' },
      { kind: 'dim', content: 'aside' },
    ]);
  });

  it('joins multiple arguments with a single space', async () => {
    const env = envWithScript('args.js', "console.log('host:', '10.0.0.5')\n");

    const result = await node.execute(env, ['args.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['host: 10.0.0.5']);
  });

  it('renders an object argument as JSON rather than [object Object]', async () => {
    const env = envWithScript('object.js', 'console.log({ port: 22, open: true })\n');

    const result = await node.execute(env, ['object.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['{"port":22,"open":true}']);
  });

  it('renders an array of strings one element per line', async () => {
    // What makes `console.log(await nmap(…))` read as captured output rather
    // than as a JSON array once commands become callable.
    const env = envWithScript('list.js', "console.log(['22/tcp open', '80/tcp open'])\n");

    const result = await node.execute(env, ['list.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['22/tcp open', '80/tcp open']);
  });

  it('renders a mixed array as JSON, since only an all-string array is output', async () => {
    // The one-per-line rule exists so captured command output reads as lines;
    // an array holding anything else is data, and printing it as lines would
    // lose the distinction between an element and a line break.
    const env = envWithScript('mixed.js', "console.log(['open', 22])\n");

    const result = await node.execute(env, ['mixed.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['["open",22]']);
  });

  it('prints undefined rather than nothing', async () => {
    // JSON has no undefined, so a value that does not survive stringifying
    // falls back to its own text — a script printing an unset variable must
    // not look like a script that printed a blank line.
    const env = envWithScript('unset.js', 'console.log(undefined)\n');

    const result = await node.execute(env, ['unset.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['undefined']);
  });

  it('reports a thrown error, exits 1, and keeps what the script already printed', async () => {
    const env = envWithScript(
      'boom.js',
      ["console.log('before')", "throw new Error('target unreachable')", ''].join('\n'),
    );

    const result = await node.execute(env, ['boom.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      { kind: 'text', content: 'before' },
      { kind: 'error', content: 'Error: target unreachable' },
    ]);
  });

  it('reports a syntax error the same way rather than taking the terminal down', async () => {
    const env = envWithScript('broken.js', "console.log('unclosed'\n");

    const result = await node.execute(env, ['broken.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['shadow.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['own.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['/root/secret.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: /root/secret.js: Permission denied']);
  });

  it('reports a missing file operand', async () => {
    const result = await node.execute(mockCommandEnv(), [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: missing file operand']);
  });

  it('reports a script that is not there', async () => {
    const env = mockCommandEnv({ fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }) });

    const result = await node.execute(env, ['/root/gone.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: /root/gone.js: No such file or directory']);
  });

  it('reports a directory given where a script was expected', async () => {
    const tree = buildDirectory({ etc: buildDirectory({}, { owner: 'root' }) });
    const env = mockCommandEnv({ fs: mockFsViewFromTree(tree, { userType: 'user' }) });

    const result = await node.execute(env, ['/etc'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(errorLines(result)).toEqual(['node: /etc: Is a directory']);
  });

  it('treats an empty script as a no-op that exits 0', async () => {
    const env = envWithScript('empty.js', '   \n\n');

    const result = await node.execute(env, ['empty.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['await.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['run.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['names.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['run.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['hop.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['scan.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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

    const result = await node.execute(env, ['shadow.js'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['mine']);
  });

  it('carries a manual and sits with the filesystem commands in help', async () => {
    expect(commandRegistry.get('node')?.category).toBe('filesystem');

    const result = await man.execute(mockCommandEnv(), ['node'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
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
    expect(description).toContain('cannot yet read and write files');
    expect(contents).toContain("    const out = await nmap('10.0.0.5')");
    expect(contents).toContain("        Inside a script: scan a host and keep the scan's lines");
  });
});
