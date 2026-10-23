/**
 * passwd — change an account's password by rewriting its md5 hash in
 * `/etc/passwd`. The write-mirror of `su`.
 *
 * On the player's own workstation a caller may change their OWN account at any
 * tier (a setuid-root `passwd`), but changing a NAMED account other than their
 * own requires root. The privilege check is made up front, before any prompt:
 * the client already knows its own tier, so prompting a caller who cannot
 * proceed would only waste a masked prompt on a refusal.
 */

import type { Command, CommandEnv, CommandResult } from './types.js';
import { PATCH_ERROR_REASON } from './types.js';
import { md5 } from '../generation/md5.js';
import { accountIn, withAccountHash, PASSWD_PATH } from '../sessions/passwdAccount.js';

const refusal = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

const CURRENT_PROMPT = 'Current password: ';
const NEW_PROMPT = 'New password: ';
const RETYPE_PROMPT = 'Retype new password: ';

/** The player cancelled a masked prompt (Ctrl-C). Exit 130 (SIGINT) with nothing
 *  written — exactly what a cancelled `su` prompt does. */
const CANCELLED: unique symbol = Symbol('cancelled');

const askMasked = async (env: CommandEnv, message: string): Promise<string | typeof CANCELLED> => {
  try {
    return await env.prompt({ message, masked: true });
  } catch {
    return CANCELLED;
  }
};

const ABORTED: CommandResult = { kind: 'sync', lines: [], exitCode: 130 };

/** Leave the real-`passwd` breadcrumb on the box's own `/var/log/auth.log` — a later
 *  root (or the guardian's round) reads it back to see that, and when, a password
 *  changed. The SERVER stamps the UTC time and pid; the client names only the event.
 *  Awaited so an immediate `cat /var/log/auth.log` already shows the line, but
 *  best-effort: the password has already changed, so a logging hiccup must not fail
 *  the change. Written on SUCCESS only — the lone own-box failure is the owner
 *  fumbling their own current password, which informs nobody. */
const logChange = async (env: CommandEnv, target: string): Promise<void> => {
  try {
    await env.log.appendAuthLog({
      kind: 'passwdChange',
      machineId: env.session.machineId,
      targetUser: target,
      hostname: env.hostname,
    });
  } catch {
    // best-effort: the change has already landed; logging must not undo it.
  }
};

/** Read `/etc/passwd` at ROOT privilege via `stat` (which resolves the raw node,
 *  bypassing the caller's read perms) — the setuid-root read `su` also makes.
 *  Returns the file text, or '' when passwd is missing or not a file. This is the
 *  content the rewrite is composed against, carried as `baseContent` so a racing
 *  writer's change is detected rather than clobbered. */
const readPasswd = (env: CommandEnv): string => {
  const node = env.fs.stat(PASSWD_PATH);
  return node !== null && node.kind === 'file' ? node.content : '';
};

const execute: Command['execute'] = async (env, args) => {
  const target = args[0] ?? env.session.username;
  const isOwnAccount = target === env.session.username;
  const callerIsRoot = env.session.userType === 'root';

  // Changing someone else's account needs root; the caller's tier is known here,
  // so refuse before any prompt rather than after.
  if (!isOwnAccount && !callerIsRoot) {
    return refusal(`passwd: you may not change the password for '${target}'`);
  }

  // Read the box's tree once at ROOT privilege (`env.fs.root()` resolves the raw
  // tree, bypassing the caller's read perms) — the setuid-root read `su` also makes.
  // The account lookup and the row rewrite then compose against one same snapshot.
  const root = env.fs.root();
  const account = accountIn(root, target);
  if (account === null) {
    return refusal(`passwd: user '${target}' does not exist`);
  }

  // A non-root caller changing their own account proves the current password first,
  // exactly as `su` does — unless the account is password-less (empty hash), where the
  // check could never pass and the prompt is skipped (mirrors su's `needsPassword`).
  if (!callerIsRoot && account.hash !== '') {
    const current = await askMasked(env, CURRENT_PROMPT);
    if (current === CANCELLED) return ABORTED;
    if (md5(current) !== account.hash) {
      return refusal('passwd: Authentication failure');
    }
  }

  const newPassword = await askMasked(env, NEW_PROMPT);
  if (newPassword === CANCELLED) return ABORTED;
  const retyped = await askMasked(env, RETYPE_PROMPT);
  if (retyped === CANCELLED) return ABORTED;
  // An empty hash is how this engine marks a password-less account, so an empty new
  // password is rejected rather than silently stripping the account's password.
  if (newPassword === '') {
    return refusal('passwd: No password supplied');
  }
  if (newPassword !== retyped) {
    return refusal('passwd: Sorry, passwords do not match');
  }

  const rewritten = withAccountHash(root, target, md5(newPassword));
  const result = await env.patches.write(PASSWD_PATH, rewritten, { baseContent: readPasswd(env) });
  if (!result.ok) {
    // A stale buffer gets its own sentence: the file moved under us, so the typed
    // password is discarded and the player re-runs rather than clobbering the other
    // writer. Every other failure speaks the shared patch-error vocabulary.
    if (result.error === 'modified_since_open') {
      return refusal('passwd: /etc/passwd changed underneath you — try again');
    }
    return refusal(`passwd: ${PATCH_ERROR_REASON[result.error]}`);
  }

  await logChange(env, target);
  return {
    kind: 'sync',
    lines: [{ kind: 'text', content: 'passwd: password updated successfully' }],
    exitCode: 0,
  };
};

export const passwd: Command = {
  name: 'passwd',
  description: 'Change an account password',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  withoutTty: 'passwd: must be run from a terminal',
  withoutScript: 'passwd: cannot be run from a script',
  manual: {
    synopsis: 'passwd [username]',
    description:
      'Change an account password by rewriting its hash in /etc/passwd. With no ' +
      'argument, changes your own account; a non-root caller is first asked for the ' +
      'current password. Naming another account changes that account and requires root.',
    arguments: [
      {
        name: 'username',
        description: 'The account to change (e.g. "root"). Defaults to your own account.',
      },
    ],
    examples: [
      { command: 'passwd', description: 'Change your own password' },
      { command: 'passwd root', description: 'Change root’s password (requires root)' },
    ],
  },
  execute,
};
