/**
 * Command availability — the RUNTIME side of the binary/availability model
 * (Slice 1: `/bin` presence + execute-perm gating).
 *
 * A command only runs when its binary exists on the CURRENT machine's
 * filesystem and the session tier may execute it. `wrapWithBinaryCheck` is a
 * higher-order function applied at registry build (see `registry.ts`): it reads
 * `env.fs` at EXECUTION time, so the per-machine, mutable filesystem is the
 * single source of truth — removing `/bin/ls` makes `ls` report
 * `command not found`, restoring it makes `ls` work again.
 *
 * This module never imports the binary NAME lists from generation: it resolves
 * `/bin/<name>` against the live FS and reads the binary's own `perms.execute`.
 * Generation stamps the perms; the runtime reads them. One-way, no shared list.
 *
 * Shell builtins (`cd`/`echo`/…) and game commands (`identity`/…) are NOT real
 * Linux tools — they have no binary and are always available, so the registry
 * skips wrapping them (`isAlwaysAvailable`).
 *
 * Deferred to later slices: `/usr/bin` + `/usr/sbin` resolution, the
 * `apt install <pkg>` install hint, and the `/lib/*.so` library check.
 */

import { asAbsPath } from '../types';
import type { UserType } from '../types';
import type { Command, CommandResult } from './types';

/** Shell builtins — always available, no binary needed. Ported from legacy
 *  `SHELL_BUILTINS` (superset of the commands v2 implements today). */
const SHELL_BUILTINS: ReadonlySet<string> = new Set([
  'cd',
  'exit',
  'clear',
  'echo',
  'pwd',
  'help',
  'whoami',
  'bash',
]);

/** Game-specific commands — always available, not real Linux tools. Ported
 *  from legacy `GAME_COMMANDS`. */
const GAME_COMMANDS: ReadonlySet<string> = new Set([
  'missions',
  'accept',
  'abort',
  'mail',
  'author',
  'theme',
  'reset',
  'xterm',
  'identity',
]);

/** True for commands that need no binary (builtins + game commands); the
 *  registry leaves these unwrapped. */
export const isAlwaysAvailable = (name: string): boolean =>
  SHELL_BUILTINS.has(name) || GAME_COMMANDS.has(name);

const syncError = (content: string, exitCode: number): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

/**
 * Wrap a command so it gates on its `/bin` binary at execution time. Metadata
 * (name, category, tier, manual, …) is preserved untouched — only `execute` is
 * intercepted — so `help`/`man` and tab-completion still see the real command.
 *
 * The check is inlined (no intermediate `{found, permitted}` object) because
 * nothing else consumes that shape in v2 — resolving `/bin/<name>` and reading
 * its `perms.execute` is the whole gate. Root bypasses the execute allowlist.
 */
export const wrapWithBinaryCheck = (command: Command): Command => ({
  ...command,
  execute: async (env, args, flags): Promise<CommandResult> => {
    const binary = env.fs.stat(asAbsPath(`/bin/${command.name}`));
    if (binary === null || binary.kind !== 'file') {
      return syncError(`bash: ${command.name}: command not found`, 127);
    }
    const tier: UserType = env.session.userType;
    if (tier !== 'root' && !binary.perms.execute.includes(tier)) {
      return syncError(`bash: ${command.name}: Permission denied`, 126);
    }
    return command.execute(env, args, flags);
  },
});
