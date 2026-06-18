/**
 * nano — open a file in a full-screen terminal editor.
 *
 * Behavior:
 * - With a file arg, reads the target and returns a `mode_change` that hands the
 *   path + raw content to the UI editor. A not-yet-existing path opens an empty
 *   buffer (a new file — created on save). A directory or an unreadable file is
 *   an error that does NOT enter the editor. With no arg, a usage error.
 * - The editor is always allowed to OPEN a readable file; write permission gates
 *   the SAVE (the patch model returns permission_denied/no_session there), not
 *   the open — so nano needs no tier higher than `guest`.
 *
 * nano is preinstalled on every machine (no `apt install`), like `cat`/`ls`.
 */

import type { Command, CommandEnv, CommandResult } from './types';
import { resolveAbsPath } from '../filesystem/path';

/** Format the `nano: <target>: <reason>` line for a target that can't be opened.
 *  `not_found` is handled by the caller (it opens an empty buffer), so only the
 *  two genuine open failures reach here. */
const formatOpenError = (target: string, error: 'permission_denied' | 'is_directory'): string => {
  switch (error) {
    case 'is_directory':
      return `nano: ${target}: Is a directory`;
    case 'permission_denied':
      return `nano: ${target}: Permission denied`;
  }
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const target = args[0];
  if (target === undefined) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'nano: missing file operand' }],
      exitCode: 1,
    };
  }

  const path = resolveAbsPath(env.fs.cwd(), target);
  const read = env.fs.read(path);
  if (read.ok) {
    return { kind: 'mode_change', mode: { kind: 'nano', path, content: read.content } };
  }
  // A path that doesn't exist yet opens a fresh empty buffer (a new file).
  if (read.error === 'not_found') {
    return { kind: 'mode_change', mode: { kind: 'nano', path, content: '' } };
  }
  // A directory or an unreadable file never enters the editor.
  return {
    kind: 'sync',
    lines: [{ kind: 'error', content: formatOpenError(target, read.error) }],
    exitCode: 1,
  };
};

export const nano: Command = {
  name: 'nano',
  description: 'Edit a file in a full-screen editor',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'nano [file]',
    description:
      'Open FILE in a full-screen editor. An existing file is loaded for editing; a path that does not exist yet opens an empty buffer and is created on save. Ctrl-O writes the file, Ctrl-X exits.',
    arguments: [
      { name: 'file', description: 'The file to edit (created on save if it does not exist)' },
    ],
    examples: [
      { command: 'nano /etc/hosts', description: 'Edit the hosts file' },
      {
        command: 'nano notes.txt',
        description: 'Create or edit notes.txt in the current directory',
      },
    ],
  },
  execute,
};
