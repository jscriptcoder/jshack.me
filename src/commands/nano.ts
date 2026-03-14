import type { Command, NanoOpenData } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, PermissionResult } from '../filesystem/types';

type NanoContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

export const createNanoCommand = (context: NanoContext): Command => ({
  name: 'nano',
  category: 'filesystem',
  description: 'Open a file in the text editor',
  manual: {
    synopsis: 'nano(path)',
    description:
      'Open a file for editing in a nano-style text editor. ' +
      'Creates a new file if the path does not exist. ' +
      'Use Ctrl+S to save and Ctrl+X to exit.',
    arguments: [
      {
        name: 'path',
        description: 'Path to the file to edit or create (absolute or relative)',
        required: true,
      },
    ],
    examples: [
      {
        command: 'nano("script.js")',
        description: 'Edit or create a file in the current directory',
      },
      {
        command: 'nano("/tmp/notes.txt")',
        description: 'Edit or create a file at an absolute path',
      },
    ],
  },
  fn: (...args: unknown[]): NanoOpenData => {
    const path = args[0] as string | undefined;
    if (!path) {
      throw new Error('nano: missing file operand');
    }

    const { resolvePath, getNode, getUserType, canTraverse } = context;
    const userType = getUserType();
    const targetPath = resolvePath(path);

    const traversal = canTraverse(targetPath);
    if (!traversal.allowed) {
      throw new Error(`nano: ${path}: Permission denied`);
    }

    const node = getNode(targetPath);

    if (node) {
      if (node.type === 'directory') {
        throw new Error(`nano: ${path}: Is a directory`);
      }
      if (!node.permissions.read.includes(userType)) {
        throw new Error(`nano: ${path}: Permission denied`);
      }
    } else {
      const parts = targetPath.split('/').filter(Boolean);
      const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
      const parentNode = getNode(parentPath);

      if (!parentNode || parentNode.type !== 'directory') {
        throw new Error(`nano: ${path}: No such directory`);
      }
      if (!parentNode.permissions.write.includes(userType)) {
        throw new Error(`nano: ${path}: Permission denied`);
      }
    }

    return { __type: 'nano_open', filePath: targetPath };
  },
});
