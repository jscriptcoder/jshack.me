/**
 * The machine's commands, as things a script can call.
 *
 * Every registered command becomes one async function in the script's context,
 * so `await nmap('10.0.0.5')` runs the same `Command.execute`, with the same
 * `env`, at the same session tier, through the same walker as typing it would.
 * That is the whole security posture of scripting: `node` grants no capability
 * — it removes typing.
 *
 * A call returns the command's STDOUT. Anything the command sent to the other
 * line kinds is the terminal's, not the caller's, exactly as the pipeline
 * already splits them.
 *
 * One call does what the shell does to a typed line, in the shell's own order:
 * peel the trailing flags object, coerce the positionals, bind and validate the
 * flags against the command's own spec, ask whether the command may be scripted
 * at all — and only then execute. The order is `prepareStage`'s, and for its
 * reason: a refusal that arrived after `execute` would arrive after the login
 * had already been written into somebody's auth.log.
 */

import type { Command, CommandEnv, TerminalLine } from '../commands/types';
import type { FlagSpec } from '../shell/bindFlags';
import { collectStageOutput, hasTty } from '../shell/runLine';

/** The JS identifier a command is reachable by inside a script.
 *
 * Command names carry the real binary's name, hyphens included — `redis-cli`,
 * `aircrack-ng`, `new-game`. An injected name becomes a formal PARAMETER of the
 * sandbox function, and a hyphen there is a `SyntaxError` that would take down
 * every script in the game, so the identifier is derived rather than reused:
 * `redis-cli` answers to `redisCli`. */
export const scriptIdentifier = (commandName: string): string =>
  commandName
    .split('-')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');

/** What a call hands back: the command's stdout, carrying its exit code.
 *
 *  An array with an extra property is canonical JS rather than a trick —
 *  `String.prototype.match` returns exactly this shape — so `.join`, `.filter`
 *  and `.map` work unchanged and a sweep can still branch on whether the host
 *  fell. Exit codes are real and load-bearing in this shell, and a script that
 *  had to string-match output to learn what happened would rot.
 *
 *  The cost, which the manual owns: spreading the array (`[...out]`) copies the
 *  elements and drops `.exitCode`. */
export type CommandOutput = readonly string[] & { readonly exitCode: number };

export type ScriptCommand = (...args: readonly unknown[]) => Promise<CommandOutput>;

const SHELL_ERROR_NAME = 'ShellError';

/** What the SHELL says, as opposed to what the script itself got wrong.
 *
 *  A refusal and a flag mistake are both things the prompt would have answered
 *  in its own words — `apt: unrecognized option: --nope`, not
 *  `Error: apt: unrecognized option: --nope` — so `node` prints these bare and
 *  dresses everything else as the JS throw it is.
 *
 *  Tagged by `name` rather than subclassing `Error`: nothing else in this
 *  codebase declares a class, and a tag is all the discrimination needed. */
export const shellError = (message: string): Error =>
  Object.assign(new Error(message), { name: SHELL_ERROR_NAME });

export const isShellError = (error: unknown): error is Error =>
  error instanceof Error && error.name === SHELL_ERROR_NAME;

/** A trailing plain object is ALWAYS the flags map. Nothing else it could be:
 *  every other argument coerces to a string, so no call has a reason to pass an
 *  object as a positional. An array is not one — a script spreads a list of
 *  hosts, it does not hand one over whole. */
const isFlagsObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Bind a script's flags object the way `bindFlags` binds a typed line, and
 *  fail the same way.
 *
 *  A script bypasses the shell's binder entirely, so without this a mistyped
 *  `{'-P': 2222}` against a command declaring `-p` would be silently dropped —
 *  a failure mode the prompt does not have, on the one surface where the player
 *  cannot see the command being assembled.
 *
 *  `false` omits the flag rather than failing, because `{'-l': verbose}` is how
 *  a script says "maybe" and there is no way to write that at a prompt at all.
 *  An undeclared key still fails even when false, so a typo cannot hide. */
const bindScriptFlags = (
  commandName: string,
  spec: FlagSpec,
  given: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string | true> =>
  new Map(
    Object.entries(given).flatMap(([key, value]): readonly (readonly [string, string | true])[] => {
      const declared = spec[key];
      if (declared === undefined) {
        throw shellError(`${commandName}: unrecognized option: ${key}`);
      }
      if (value === false) return [];
      if (declared === 'boolean') {
        if (value !== true) {
          throw shellError(`${commandName}: option ${key} does not take a value`);
        }
        return [[key, true]];
      }
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw shellError(`${commandName}: option requires an argument: ${key}`);
      }
      return [[key, String(value)]];
    }),
  );

/** `Object.assign` onto a FRESH copy — the array is built here and handed
 *  straight to the caller, so nothing shared is mutated, and it is the only way
 *  to produce the array-plus-property shape above. */
const withExitCode = (stdout: readonly string[], exitCode: number): CommandOutput =>
  Object.assign([...stdout], { exitCode });

/** Everything reaching a command at the prompt is a string, so a number coerces
 *  and `nc(4444, …)` means what it looks like.
 *
 *  `undefined` and `null` do not: they are almost always an out-of-range index
 *  or a property that was not there, and coercing them sends the command off
 *  after a host or a file literally called `undefined` — which reports the
 *  mistake as a FILESYSTEM error and points the player at the wrong thing
 *  entirely. Real node's `execSync` refuses the same input. */
const coercePositional = (value: unknown, commandName: string, position: number): string => {
  if (value === undefined || value === null) {
    throw new TypeError(`${commandName}() argument ${position} is ${String(value)}`);
  }
  return String(value);
};

/** The command's own refusal, or `undefined` when it may be scripted. The
 *  function form asks the call — that is `nc`, which permits `-l` and refuses
 *  the form that hops. */
const refuseFromScript = (
  command: Command,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): string | undefined =>
  typeof command.withoutScript === 'function'
    ? command.withoutScript(args, flags)
    : command.withoutScript;

/** `emit` takes the lines a call does NOT hand back — a command's stderr and
 *  its dim asides. They belong to the terminal the moment the command writes
 *  them, so a script's failures are visible even when the script ignores what
 *  the call returned. The caller owns the collector, which is what keeps a
 *  script's whole output inside `node`'s own `CommandResult`, and therefore
 *  pipeable. */
export const buildCommandContext = (
  env: CommandEnv,
  commands: ReadonlyMap<string, Command>,
  emit: (line: TerminalLine) => void,
): Readonly<Record<string, ScriptCommand>> =>
  Object.fromEntries(
    [...commands.values()].map((command) => [
      scriptIdentifier(command.name),
      async (...args: readonly unknown[]): Promise<CommandOutput> => {
        // Asked BEFORE anything is bound, and it is the half a script cannot
        // defeat. A loop that catches its own failures — `try { await nmap(h) }
        // catch {}` — swallows whatever this throws and comes back for the next
        // host; without the check the next host would be scanned for real
        // first, so Ctrl-C would stop the script without stopping the work.
        env.signal.throwIfAborted();

        const trailing = args.at(-1);
        const given = isFlagsObject(trailing) ? trailing : undefined;
        const rest = given === undefined ? args : args.slice(0, -1);

        const positional = rest.map((value, index) =>
          coercePositional(value, command.name, index + 1),
        );
        const flags = bindScriptFlags(command.name, command.flags ?? {}, given ?? {});

        // Last of the three, and BEFORE `execute` — the same order
        // `prepareStage` uses at the prompt, for the same reason: `ssh`
        // authenticates against the server and writes a line into the target's
        // auth.log before it returns, so a refusal that landed afterwards would
        // already have happened.
        const refusal = refuseFromScript(command, positional, flags);
        if (refusal !== undefined) {
          throw shellError(refusal);
        }

        // The tty rule is a DIFFERENT fact and still holds: `scp` is not in the
        // refusal set — it pushes no session, shows no screen and opens no
        // sub-shell — but it prompts for a password, and a shell reached
        // through a planted listener has nobody to ask. Without this, a script
        // is the one way to reach a masked prompt over a pty-less session.
        if (!hasTty(env.session) && command.withoutTty !== undefined) {
          throw shellError(command.withoutTty);
        }

        // Claimed only once every refusal has passed, so a command that never
        // ran never flashes on the bar — and released in a `finally`, so one
        // that dies partway does not leave its name sitting there with nothing
        // behind it. Held across the drain too: a streamed command is still
        // running while its lines are arriving.
        env.setChildCommand(command.name);
        try {
          const result = await command.execute(env, positional, flags);
          const { stdout, passthrough, exitCode } = await collectStageOutput(result);
          // Emitted BEFORE the second check, deliberately: the command really
          // did write those lines, and the interrupt is not a reason to keep
          // them from the player. Only the RESULT is withheld — a command that
          // finished as the key went down must not hand its output back to the
          // script, or the sweep records the host it was told to stop scanning.
          passthrough.forEach(emit);
          env.signal.throwIfAborted();
          return withExitCode(stdout, exitCode);
        } finally {
          env.setChildCommand(null);
        }
      },
    ]),
  );
