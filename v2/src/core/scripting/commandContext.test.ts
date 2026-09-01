import { describe, expect, it } from 'vitest';
import { buildCommandContext, scriptIdentifier } from './commandContext';
import { cat } from '../commands/cat';
import { echo } from '../commands/echo';
import { ls } from '../commands/ls';
import { nc } from '../commands/nc';
import { scp } from '../commands/scp';
import { commandRegistry } from '../commands/registry';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { Command, CommandEnv, TerminalLine } from '../commands/types';

/** The commands under test, wired the way `node` wires the registry. Passing
 *  the ungated command keeps these tests about the ADAPTER; the binary gate has
 *  its own test through the real registry. */
const contextOf = (commands: readonly Command[], env: CommandEnv = mockCommandEnv()) => {
  const emitted: TerminalLine[] = [];
  const context = buildCommandContext(
    env,
    new Map(commands.map((command) => [command.name, command])),
    (line) => emitted.push(line),
  );
  return { context, emitted };
};

/** A home tree holding one readable file owned by alice. */
const envWithFile = (fileName: string, content: string): CommandEnv =>
  mockCommandEnv({
    fs: mockFsViewFromTree(
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            { [fileName]: buildFile(content, { owner: 'alice' }) },
            { owner: 'alice' },
          ),
        }),
      }),
      { userType: 'user', cwd: asAbsPath('/home/alice') },
    ),
    session: mockSession({ username: 'alice', userType: 'user' }),
  });

/** Reports what the shell bound for it. A real command consumes its flags
 *  rather than showing them, so this is the only way to see the map a call
 *  produced — and it declares one flag of each kind, which is what the
 *  validation rules are written against. */
const probe: Command = {
  name: 'probe',
  description: 'Report the arguments and flags it was given',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-l': 'boolean', '-p': 'string' },
  execute: async (_env, args, flags) => ({
    kind: 'sync',
    lines: [
      ...args.map((arg) => ({ kind: 'text' as const, content: `arg:${arg}` })),
      ...[...flags].map(([key, value]) => ({
        kind: 'text' as const,
        content: `flag:${key}=${String(value)}`,
      })),
    ],
    exitCode: 0,
  }),
};

describe('a script calling the machine commands', () => {
  it('carries the exit code of a command that succeeded', async () => {
    const { context } = contextOf([echo]);

    const out = await context.echo('hi');

    expect([...out]).toEqual(['hi']);
    expect(out.exitCode).toBe(0);
  });

  it('sends a number positional as the string the shell would have seen', async () => {
    const { context } = contextOf([echo]);

    const out = await context.echo(4444);

    expect([...out]).toEqual(['4444']);
  });

  it('refuses an undefined positional rather than asking for a host called "undefined"', async () => {
    const { context } = contextOf([cat], envWithFile('present.txt', 'here\n'));

    // An out-of-range index is the commonest scripting mistake. Coerced, it
    // would come back as a FILESYSTEM error and point the player at the wrong
    // thing entirely.
    await expect(context.cat(undefined)).rejects.toThrow(
      'cat() argument 1 is undefined',
    );
    await expect(context.cat('present.txt', null)).rejects.toThrow(
      'cat() argument 2 is null',
    );
  });

  it('reads a trailing object as flags, with the dashed keys the player already types', async () => {
    const { context } = contextOf([probe]);

    const out = await context.probe('host', { '-l': true, '-p': 2222 });

    // The object is flags, not a positional, and a number value becomes the
    // string the shell would have consumed from the next token.
    expect([...out]).toEqual(['arg:host', 'flag:-l=true', 'flag:-p=2222']);
  });

  it('changes what a real command does, the way the same flag does at the prompt', async () => {
    const { context } = contextOf([ls], envWithFile('.hidden', 'x'));

    const plain = await context.ls();
    const all = await context.ls({ '-a': true });

    expect(plain.join(' ')).not.toContain('.hidden');
    expect(all.join(' ')).toContain('.hidden');
  });

  it('leaves a flag off when its value is false, so a flag can be conditional', async () => {
    const { context } = contextOf([probe]);

    // `{ '-l': verbose }` is how a script says "maybe", and there is no way to
    // write it at the prompt at all.
    const out = await context.probe({ '-l': false });

    expect([...out]).toEqual([]);
  });

  it("answers an undeclared flag in the shell's own words", async () => {
    const { context } = contextOf([probe]);

    // A script bypasses `bindFlags` entirely, so without this it would have a
    // silent failure mode the prompt does not have.
    await expect(context.probe({ '-x': true })).rejects.toThrow(
      'probe: unrecognized option: -x',
    );
  });

  it('refuses a flag given the wrong kind of value', async () => {
    const { context } = contextOf([probe]);

    await expect(context.probe({ '-p': true })).rejects.toThrow(
      'probe: option requires an argument: -p',
    );
    await expect(context.probe({ '-l': 'yes' })).rejects.toThrow(
      'probe: option -l does not take a value',
    );
  });

  it('refuses every command that would lie about where the script is standing', async () => {
    // Three structural reasons, one refusal: pushes or pops a session the
    // script cannot see (ssh/su/nc/exit/reboot), returns a screen
    // (nano/lynx), or opens a sub-shell prompt (mysql/redis-cli/ftp).
    const refused = [
      'ssh',
      'su',
      'nc',
      'exit',
      'reboot',
      'nano',
      'lynx',
      'mysql',
      'redis-cli',
      'ftp',
    ];
    const context = buildCommandContext(mockCommandEnv(), commandRegistry, () => {});

    const answers = await Promise.all(
      refused.map(async (name) => {
        try {
          await context[scriptIdentifier(name)]();
          return `${name}: RAN`;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }),
    );

    expect(answers).toEqual(refused.map((name) => `${name}: cannot be run from a script`));
  });

  it('refuses BEFORE the command runs, so nothing has side-effected first', async () => {
    // `ssh` authenticates against the server and writes a real line into the
    // target's auth.log before it returns. A refusal that landed after
    // `execute` would already have happened.
    const neverRuns: Command = {
      ...probe,
      name: 'neverRuns',
      withoutScript: 'neverRuns: cannot be run from a script',
      execute: async () => {
        throw new Error('the command ran');
      },
    };
    const { context } = contextOf([neverRuns]);

    await expect(context.neverRuns()).rejects.toThrow('neverRuns: cannot be run from a script');
  });

  it('lets nc listen from a script, and only refuses the form that hops', async () => {
    // Planting a backdoor on a box you never logged into is the beat this
    // exemption exists for; a plant takes root, as it does at the prompt.
    const asRoot = mockCommandEnv({
      session: mockSession({ username: 'root', userType: 'root' }),
      patches: { ...mockPatchApi(), write: async () => ({ ok: true }) },
    });

    const listening = await contextOf([nc], asRoot).context.nc(4444, { '-l': true });

    expect([...listening]).toEqual(['Listening on 0.0.0.0 4444']);
    await expect(contextOf([nc], asRoot).context.nc('10.0.0.5', 4444)).rejects.toThrow(
      'nc: cannot be run from a script',
    );
  });

  it('still needs a terminal for a command that needs one', async () => {
    // `scp` is deliberately NOT in the refusal set — it pushes no session,
    // returns no screen and enters no sub-shell. But it prompts for a password,
    // and a session reached through a planted listener has nobody to ask, so
    // the tty rule has to hold from a script too. Otherwise this is the one way
    // to reach a masked prompt over a pty-less shell.
    const throughABackdoor = mockCommandEnv({ session: mockSession({ kind: 'nc' }) });
    const { context } = contextOf([scp], throughABackdoor);

    await expect(context.scp('file.txt', 'root@10.0.0.5:/root/')).rejects.toThrow(
      'scp: must be run from a terminal',
    );
  });

  it("carries a failed command's own exit code, so a sweep can branch on it", async () => {
    const { context } = contextOf([cat], envWithFile('present.txt', 'here\n'));

    const out = await context.cat('missing.txt');

    expect(out.exitCode).toBe(1);
  });
});
