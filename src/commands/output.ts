import type { Command, AsyncOutput } from '../components/Terminal/types';
import { isAsyncOutput } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { PermissionResult } from '../filesystem/types';
import { stringify } from '../utils/stringify';

type OutputContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => unknown;
  readonly getUserType: () => UserType;
  readonly createFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
};

const collectAsyncOutput = (asyncOutput: AsyncOutput): Promise<string> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    asyncOutput.start(
      (line) => lines.push(line),
      () => resolve(lines.join('\n')),
    );
  });

const writeToFile = (context: OutputContext, filePath: string, content: string): void => {
  const { resolvePath, getNode, getUserType, createFile, writeFile } = context;
  const userType = getUserType();
  const resolvedPath = resolvePath(filePath);
  const existingNode = getNode(resolvedPath);

  if (existingNode) {
    const result = writeFile(filePath, content, userType);
    if (!result.allowed) {
      throw new Error(`output: ${result.error}`);
    }
  } else {
    const result = createFile(filePath, content, userType);
    if (!result.allowed) {
      throw new Error(`output: ${result.error}`);
    }
  }
};

export const createOutputCommand = (context: OutputContext): Command => ({
  name: 'output',
  category: 'general',
  description: 'Capture command output to variable or file',
  manual: {
    synopsis: 'output(command, [filePath])',
    description:
      'Captures the output of a command. If filePath is provided, writes the output to a file. ' +
      'For synchronous commands, returns the output string directly. ' +
      'For asynchronous commands (ping, nmap, etc.), returns a Promise that resolves to the output.',
    arguments: [
      {
        name: 'command',
        description: 'The command whose output to capture',
        required: true,
      },
      {
        name: 'filePath',
        description: 'Optional path to write the output to a file',
        required: false,
      },
    ],
    examples: [
      {
        command: 'const content = output(cat("file.txt"))',
        description: 'Capture file content to a variable',
      },
      {
        command: 'const log = await output(ping("host", 3))',
        description: 'Capture async command output (note: returns Promise)',
      },
      {
        command: 'output(cat("secret.txt"), "/tmp/backup.txt")',
        description: 'Copy file content to another file',
      },
      {
        command: 'await output(gpg("secret.enc", key), "/tmp/decrypted.txt")',
        description: 'Decrypt and save to file',
      },
    ],
  },
  fn: (value: unknown, filePath?: unknown): string | Promise<string> => {
    const filePathStr = filePath as string | undefined;

    if (isAsyncOutput(value)) {
      return collectAsyncOutput(value).then((content) => {
        if (filePathStr) {
          writeToFile(context, filePathStr, content);
        }
        return content;
      });
    }

    const content = stringify(value);

    if (filePathStr) {
      writeToFile(context, filePathStr, content);
    }

    return content;
  },
});
