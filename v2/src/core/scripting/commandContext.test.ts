import { describe, expect, it, vi } from 'vitest';
import { buildCommandContext, scriptIdentifier } from './commandContext';
import { cat } from '../commands/cat';
import { author } from '../commands/author';
import { clear } from '../commands/clear';
import { theme } from '../commands/theme';
import { xterm } from '../commands/xterm';
import { find } from '../commands/find';
import { strings } from '../commands/strings';
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

  it('passes a string value through to a flag that takes one', async () => {
    const { context } = contextOf([probe]);

    const out = await context.probe({ '-p': 'ssh' });

    expect([...out]).toEqual(['flag:-p=ssh']);
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

  it('lets a command that needs a terminal run from a script when there IS one', async () => {
    // The tty rule and the script rule are separate facts, and this is the
    // direction that says so: scp is not in the refusal set, so from an
    // ordinary logged-in session a script may drive it. Collapsing the two
    // conditions into "or" would refuse it here.
    const needsTerminal: Command = {
      ...probe,
      name: 'needsTerminal',
      withoutTty: 'needsTerminal: must be run from a terminal',
    };
    const { context } = contextOf([needsTerminal]);

    const out = await context.needsTerminal('ran');

    expect([...out]).toEqual(['arg:ran']);
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

  it('leaves a command that needs no terminal alone on a pty-less session', async () => {
    // The other side of that condition, and the reason it is a condition at all.
    // A shell reached through a planted listener has nobody to ask for a
    // password — but almost nothing asks. If the tty check stopped at "is there
    // a terminal", every ordinary command a script ran over a backdoor would be
    // refused, and refused with `undefined` as the message, because the sentence
    // is the absent command's to supply.
    const throughABackdoor = mockCommandEnv({ session: mockSession({ kind: 'nc' }) });
    const { context } = contextOf([probe], throughABackdoor);

    const out = await context.probe('ran');

    expect([...out]).toEqual(['arg:ran']);
  });

  it('names the running command to the UI, and hands the name back when it returns', async () => {
    // One array records both the label changes and the command's own run, so the
    // assertion is about ORDER as much as value: the label is claimed BEFORE the
    // command runs (a player watching a slow scan must see `nmap` for its whole
    // duration, not at the end) and released after, so the bar says `node` again
    // while the script does its own work.
    const events: (string | null)[] = [];
    const watcher: Command = {
      ...probe,
      name: 'watcher',
      execute: async () => {
        events.push('ran');
        return { kind: 'sync', lines: [], exitCode: 0 };
      },
    };
    const env = mockCommandEnv({
      setChildCommand: (name) => {
        events.push(name);
      },
    });

    await contextOf([watcher], env).context.watcher();

    expect(events).toEqual(['watcher', 'ran', null]);
  });

  it('hands the name back even when the command throws', async () => {
    // Otherwise a script that dies inside `hydra` leaves the bar reading `hydra`
    // with nothing running behind it.
    const events: (string | null)[] = [];
    const exploder: Command = {
      ...probe,
      name: 'exploder',
      execute: async () => {
        throw new Error('the command blew up');
      },
    };
    const env = mockCommandEnv({
      setChildCommand: (name) => {
        events.push(name);
      },
    });

    await expect(contextOf([exploder], env).context.exploder()).rejects.toThrow(
      'the command blew up',
    );

    expect(events).toEqual(['exploder', null]);
  });

  it('never claims the label for a command that was refused', async () => {
    // The refusal gates run first, so nothing ran and nothing should have been
    // announced — a `ssh` that never happened must not flash on the bar.
    const events: (string | null)[] = [];
    const env = mockCommandEnv({
      setChildCommand: (name) => {
        events.push(name);
      },
    });
    const blocked: Command = {
      ...probe,
      name: 'blocked',
      withoutScript: 'blocked: cannot be run from a script',
    };

    await expect(contextOf([blocked], env).context.blocked()).rejects.toThrow(
      'blocked: cannot be run from a script',
    );

    expect(events).toEqual([]);
  });

  it.each([
    [clear, 'clear: cannot be run from a script'],
    [theme, 'theme: cannot be run from a script'],
    [author, 'author: cannot be run from a script'],
    [xterm, 'xterm: cannot be run from a script'],
  ])('refuses to let a script act on a terminal nobody is watching: %#', async (command, refusal) => {
    // A DIFFERENT fact from needing a tty. A script run from a real terminal has
    // one — but the player is watching the script's output scroll past, and a
    // line that wiped the screen or repainted it mid-run would be acting on a
    // terminal they are reading rather than driving.
    const { context } = contextOf([command]);

    await expect(context[command.name]()).rejects.toThrow(refusal);
  });

  it('lets a script search a box and read what it finds', async () => {
    const env = envWithFile('notes.txt', 'hello world\nfrom alice\n');

    const found = await contextOf([find], env).context.find('/home/alice', '*.txt');
    const read = await contextOf([strings], env).context.strings('/home/alice/notes.txt');

    // The other side of the refusal table above. These two act on a
    // filesystem, not on a terminal — a script that sweeps a box for a
    // filename and reads what it turns up is the reason the scripting door
    // exists, so a refusal here would be the bug.
    expect(found.exitCode).toBe(0);
    expect([...found]).toContain('/home/alice/notes.txt');
    expect(read.exitCode).toBe(0);
    expect([...read]).toContain('from alice');
  });

  it("carries a failed command's own exit code, so a sweep can branch on it", async () => {
    const { context } = contextOf([cat], envWithFile('present.txt', 'here\n'));

    const out = await context.cat('missing.txt');

    expect(out.exitCode).toBe(1);
  });
});

describe('a run the player interrupted', () => {
  /** A command that records every time it actually ran, so a test can say what
   *  the guard PREVENTED rather than only what it reported. */
  const recorder = (
    duringRun: () => void = () => undefined,
  ): { readonly command: Command; readonly runs: ReturnType<typeof vi.fn> } => {
    const runs = vi.fn<Command['execute']>(async () => {
      duringRun();
      return { kind: 'sync', lines: [{ kind: 'text', content: 'scanned' }], exitCode: 0 };
    });
    return {
      command: {
        name: 'probe',
        description: 'Pretend to scan a host',
        category: 'general',
        tier: 'guest',
        availability: { kind: 'any-machine' },
        execute: runs,
      },
      runs,
    };
  };

  it('will not START a command once the run has been aborted', async () => {
    // The half that matters most, and the half a script cannot defeat. A loop
    // that catches its own failures — `try { await nmap(h) } catch {}` — swallows
    // whatever the guard throws and comes straight back for the next host. If
    // the only check ran after `execute`, every one of those iterations would
    // send a real command to the server first: Ctrl-C would stop the script
    // without stopping the work.
    const controller = new AbortController();
    const { command, runs } = recorder();
    const { context } = contextOf([command], mockCommandEnv({ signal: controller.signal }));

    await context.probe('10.0.0.1');
    controller.abort();

    await expect(context.probe('10.0.0.2')).rejects.toBe(controller.signal.reason);
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('reports the interrupt for a command that finished as the key went down', async () => {
    // The other half: the command ran to completion, so a before-only guard has
    // nothing left to catch. Handing its output back would have the script act
    // on the host it was told to stop scanning — and record it.
    const controller = new AbortController();
    const { command, runs } = recorder(() => controller.abort());
    const { context } = contextOf([command], mockCommandEnv({ signal: controller.signal }));

    await expect(context.probe('10.0.0.1')).rejects.toBe(controller.signal.reason);
    expect(runs).toHaveBeenCalledTimes(1);
  });
});
