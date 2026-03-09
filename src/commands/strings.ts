import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, PermissionResult } from '../filesystem/types';

type StringsContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

// Matches the default minimum length of the real Unix `strings` command
const MIN_STRING_LENGTH = 4;

const isPrintable = (charCode: number): boolean =>
  (charCode >= 32 && charCode <= 126) || charCode === 10 || charCode === 9;

const extractStrings = (
  content: string,
  minLength: number = MIN_STRING_LENGTH,
): readonly string[] => {
  const results: string[] = [];
  let current = '';

  for (let i = 0; i < content.length; i++) {
    const charCode = content.charCodeAt(i);

    if (isPrintable(charCode)) {
      current += content[i];
    } else {
      if (current.length >= minLength) {
        results.push(current.trim());
      }
      current = '';
    }
  }

  if (current.length >= minLength) {
    results.push(current.trim());
  }

  return results.filter((s) => s.length > 0);
};

export const createStringsCommand = (context: StringsContext): Command => ({
  name: 'strings',
  category: 'filesystem',
  description: 'Extract printable strings from a file',
  manual: {
    synopsis: 'strings(file, [minLength])',
    description:
      'Print the sequences of printable characters in a file. ' +
      'Useful for extracting readable text from binary files. ' +
      'By default, prints strings of 4 or more characters.',
    arguments: [
      {
        name: 'file',
        description: 'Path to the file to scan',
        required: true,
      },
      {
        name: 'minLength',
        description: 'Minimum string length to extract (default: 4)',
        required: false,
      },
    ],
    examples: [
      {
        command: 'strings("/bin/sudo")',
        description: 'Extract strings from a binary',
      },
      {
        command: 'strings("program.exe", 8)',
        description: 'Extract strings of 8+ characters',
      },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { resolvePath, getNode, getUserType } = context;

    const filePath = args[0] as string | undefined;
    const minLength = (args[1] as number | undefined) ?? MIN_STRING_LENGTH;

    if (!filePath) {
      throw new Error('strings: missing file operand');
    }

    if (minLength < 1 || minLength > 100) {
      throw new Error('strings: minimum length must be between 1 and 100');
    }

    const userType = getUserType();
    const targetPath = resolvePath(filePath);

    const traversal = context.canTraverse(targetPath);
    if (!traversal.allowed) {
      throw new Error(`strings: ${filePath}: Permission denied`);
    }

    const node = getNode(targetPath);

    if (!node) {
      throw new Error(`strings: ${filePath}: No such file or directory`);
    }

    if (node.type === 'directory') {
      throw new Error(`strings: ${filePath}: Is a directory`);
    }

    // Root bypass: root isn't always listed in file permission arrays (some machines
    // define restrictive permissions), but root should always have access
    if (!node.permissions.read.includes(userType) && userType !== 'root') {
      throw new Error(`strings: ${filePath}: Permission denied`);
    }

    const content = node.content ?? '';
    if (!content) {
      return '';
    }

    const strings = extractStrings(content, minLength);
    return strings.join('\n');
  },
});
