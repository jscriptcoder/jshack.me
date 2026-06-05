/**
 * su — switch user (root only, for now). Prompts (masked) for the root password,
 * validates it against the `root` row of `/etc/passwd` (md5), and on success
 * pushes a root session onto the hop chain + moves to /root. `exit` (later slice)
 * pops back.
 *
 * The password flows through `env.prompt` — the GENERAL interactive-input
 * primitive (masked here) that ssh/scp/ftp/mysql/redis reuse — so su carries no
 * prompt UI of its own. Validation is FS-driven: it reads `/etc/passwd` (root +
 * user readable; guest can't, so guest can never elevate) and compares against
 * the stored hash, the source of truth that survives a future `passwd` change.
 * Wrong password — or an unreadable/rowless passwd — is a single
 * `Authentication failure`, never leaking which check failed.
 */

import { asAbsPath } from '../types';
import { md5 } from '../generation/md5';
import type { Command, CommandEnv, CommandResult, Session } from './types';

const PASSWD_PATH = asAbsPath('/etc/passwd');
const ROOT_HOME = asAbsPath('/root');

const failure = (): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: 'su: Authentication failure' }],
  exitCode: 1,
});

/** The password hash from the `root` row of `/etc/passwd` text, or null if the
 *  row (or its hash field) is absent. Row shape:
 *  `username:hash:uid:gid:gecos:home:shell`. An empty hash falls through as `''`,
 *  which the caller's compare rejects (no md5 ever equals it). */
const rootHashFrom = (passwd: string): string | null => {
  const rootRow = passwd.split('\n').find((row) => row.startsWith('root:'));
  return rootRow?.split(':')[1] ?? null;
};

const rootSession = (env: CommandEnv): Session => ({
  id: `su-root-${env.now()}`,
  playerKey: env.session.playerKey,
  machineId: env.session.machineId,
  username: 'root',
  userType: 'root',
  kind: 'su',
  createdAt: env.now(),
});

const execute: Command['execute'] = async (env) => {
  // Always prompt first (real su prompts before revealing any failure), and let
  // a Ctrl-C cancel unwind without elevating anything.
  let typed: string;
  try {
    typed = await env.prompt({ message: 'Password: ', masked: true });
  } catch {
    return { kind: 'sync', lines: [], exitCode: 130 };
  }

  const read = env.fs.read(PASSWD_PATH);
  if (!read.ok) return failure();

  const hash = rootHashFrom(read.content);
  if (hash === null || md5(typed) !== hash) return failure();

  env.pushSession(rootSession(env));
  env.setCwd(ROOT_HOME);
  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const su: Command = {
  name: 'su',
  description: 'Switch user (elevate to root)',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'su',
    description:
      'Switch to the root account. Prompts for the root password (set at first launch) and, on success, gives you a root shell — required for privileged commands like "apt install". Use "exit" to drop back to your user.',
    examples: [{ command: 'su', description: 'Become root after entering the root password' }],
  },
  execute,
};
