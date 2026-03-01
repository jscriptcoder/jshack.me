import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode } from '../filesystem/types';
import { passwords, guestPasswords } from '../generation/pools';
import { md5 } from '../utils/md5';
import { createCancellationToken } from '../utils/asyncCommand';

type JohnContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
};

type PasswdEntry = {
  readonly username: string;
  readonly hash: string;
};

const STEP_DELAY_MS = 300;

// Build the wordlist once and pre-compute all hashes
const wordlist: readonly string[] = [...passwords, ...guestPasswords];

const hashToPassword: ReadonlyMap<string, string> = new Map(wordlist.map((pw) => [md5(pw), pw]));

const parsePasswdLines = (content: string): readonly PasswdEntry[] =>
  content
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(':');
      const username = parts[0];
      const hash = parts[1];
      if (!username || !hash) return undefined;
      // Skip entries with placeholder hashes (x, *, !!, empty)
      if (['x', '*', '!!', ''].includes(hash)) return undefined;
      return { username, hash };
    })
    .filter((entry): entry is PasswdEntry => entry !== undefined);

export const createJohnCommand = (context: JohnContext): Command => ({
  name: 'john',
  description: 'Crack password hashes using dictionary attack',
  manual: {
    synopsis: 'john(file: string)',
    description:
      'Crack password hashes from a passwd-format file using a dictionary attack. ' +
      'Reads username:hash pairs and attempts to crack them against a built-in wordlist. ' +
      'Named after John the Ripper, the classic password cracking tool.',
    arguments: [
      {
        name: 'file',
        description: 'Path to a passwd-format file containing username:hash entries',
        required: true,
      },
    ],
    examples: [
      { command: 'john("/etc/passwd")', description: 'Crack hashes from the passwd file' },
      {
        command: 'john("/tmp/backup_hashes.txt")',
        description: 'Crack hashes from a backup file',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { resolvePath, getNode, getUserType } = context;

    const filePath = args[0] as string | undefined;

    if (!filePath) {
      throw new Error('john: missing file operand — usage: john("/etc/passwd")');
    }

    const userType = getUserType();
    const targetPath = resolvePath(filePath);
    const node = getNode(targetPath);

    if (!node) {
      throw new Error(`john: ${filePath}: No such file or directory`);
    }

    if (node.type === 'directory') {
      throw new Error(`john: ${filePath}: Is a directory`);
    }

    // Root bypass: root can read any file regardless of permissions
    if (!node.permissions.read.includes(userType) && userType !== 'root') {
      throw new Error(`john: ${filePath}: Permission denied`);
    }

    const content = node.content ?? '';
    const entries = parsePasswdLines(content);

    if (entries.length === 0) {
      throw new Error(`john: ${filePath}: No password hashes found`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Loaded ${wordlist.length} words into wordlist`);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Cracking ${entries.length} password hash${entries.length === 1 ? '' : 'es'}...`);
          onLine('');
        }, STEP_DELAY_MS);

        const crackedResults: { readonly username: string; readonly password: string }[] = [];

        entries.forEach((entry, index) => {
          token.schedule(
            () => {
              if (token.isCancelled()) return;

              const password = hashToPassword.get(entry.hash);
              if (password) {
                crackedResults.push({ username: entry.username, password });
                onLine(`${entry.username}:${password}`);
              }

              // Last entry — show summary
              if (index === entries.length - 1) {
                token.schedule(() => {
                  if (token.isCancelled()) return;
                  onLine('');
                  onLine(
                    `${crackedResults.length}/${entries.length} password hash${entries.length === 1 ? '' : 'es'} cracked`,
                  );
                  onComplete();
                }, STEP_DELAY_MS);
              }
            },
            (index + 2) * STEP_DELAY_MS,
          );
        });
      },
      cancel: token.cancel,
    };
  },
});
