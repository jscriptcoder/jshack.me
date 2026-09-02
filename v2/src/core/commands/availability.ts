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
 * The search path spans `/bin` (system utils), `/usr/bin` (apt tools), and
 * `/usr/sbin` (admin daemons like `sshd`), and both the apt-install hint and the
 * `/lib/*.so` library check are wired.
 */

import { asAbsPath } from '../types';
import type { UserType } from '../types';
import type { FileNode } from '../filesystem/types';
import type { Command, CommandEnv, CommandResult } from './types';
import { packageForBinary } from '../packages/aptPackages';

/** Shell builtins — always available, no binary needed. Listed to MATCH the
 *  builtins v2 actually implements: adding a speculative entry for an
 *  unimplemented command is dead data, and a forgotten one fails loudly
 *  (`command not found`) the moment that command ships. Grow this as builtins
 *  land — but not with `clear` or `whoami`, which legacy made builtins and v2
 *  ships as real `/bin` binaries, so `rm /bin/clear` takes the tool away like
 *  any other. */
const SHELL_BUILTINS: ReadonlySet<string> = new Set(['cd', 'echo', 'exit', 'pwd', 'help']);

/** Game-specific commands — always available, not real Linux tools. Same
 *  match-what-exists rule (legacy also had missions/accept/abort/mail/author/
 *  xterm — re-add each as it ships). */
const GAME_COMMANDS: ReadonlySet<string> = new Set(['identity', 'new-game', 'theme']);

/** True for commands that need no binary (builtins + game commands); the
 *  registry leaves these unwrapped. */
export const isAlwaysAvailable = (name: string): boolean =>
  SHELL_BUILTINS.has(name) || GAME_COMMANDS.has(name);

const syncError = (content: string, exitCode: number): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

/** Directories searched for a command's binary, in order. System utilities live
 *  in `/bin`; apt-installed tools land in `/usr/bin`; admin daemons (`sshd`)
 *  live in `/usr/sbin`. */
const BINARY_SEARCH_PATH: readonly string[] = ['/bin', '/usr/bin', '/usr/sbin'];

/** First existing binary FILE for `name` across the search path, or null. */
const resolveBinary = (env: CommandEnv, name: string): FileNode | null => {
  for (const directory of BINARY_SEARCH_PATH) {
    const node = env.fs.stat(asAbsPath(`${directory}/${name}`));
    if (node !== null && node.kind === 'file') return node;
  }
  return null;
};

/** Whether a binary named `name` is present on the current machine (resolves in
 *  `/bin` or `/usr/bin`). The single source of truth for "is this installed",
 *  reused by `apt list --installed` so it agrees with what the binary-check
 *  wrapper considers runnable. */
export const binaryExists = (env: CommandEnv, name: string): boolean =>
  resolveBinary(env, name) !== null;

/** The not-found message, enriched with an `apt install` hint when `name` is a
 *  known apt tool (a missing system util just reports plain not-found). */
const notFoundMessage = (name: string): string => {
  const pkg = packageForBinary(name);
  return pkg === undefined
    ? `bash: ${name}: command not found`
    : `bash: ${name}: command not found. Install with: apt install ${pkg}`;
};

/**
 * Wrap a command so it gates on its binary at execution time. Metadata (name,
 * category, tier, manual, …) is preserved untouched — only `execute` is
 * intercepted — so `help`/`man` and tab-completion still see the real command.
 *
 * The check is inlined (no intermediate `{found, permitted}` object) because
 * nothing else consumes that shape in v2 — resolving the binary and reading its
 * `perms.execute` is the whole gate. Root bypasses the execute allowlist.
 */
export const wrapWithBinaryCheck = (command: Command): Command => ({
  ...command,
  execute: async (env, args, flags): Promise<CommandResult> => {
    const binary = resolveBinary(env, command.name);
    if (binary === null) {
      return syncError(notFoundMessage(command.name), 127);
    }
    const tier: UserType = env.session.userType;
    if (tier !== 'root' && !binary.perms.execute.includes(tier)) {
      return syncError(`bash: ${command.name}: Permission denied`, 126);
    }
    return command.execute(env, args, flags);
  },
});
