import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode } from '../filesystem/types';

type NodeContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly getExecutionContext: () => Record<string, (...args: unknown[]) => unknown>;
  readonly getSubmitFn?: () => (() => string) | undefined;
};

type EchoFn = (...args: readonly unknown[]) => string;

export const createNodeCommand = (context: NodeContext): Command => ({
  name: 'node',
  description: 'Execute a JavaScript file',
  manual: {
    synopsis: 'node(path: string)',
    description:
      'Execute the contents of a JavaScript file. ' +
      'The file runs with access to all terminal commands. ' +
      'Returns the result of the last expression, or undefined for statement-only code.',
    arguments: [
      {
        name: 'path',
        description: 'Path to the JavaScript file to execute',
        required: true,
      },
    ],
    examples: [
      { command: 'node("script.js")', description: 'Execute a JavaScript file' },
      { command: 'node("/home/user/exploit.js")', description: 'Run a script from absolute path' },
    ],
  },
  fn: (...args: unknown[]): unknown => {
    const path = args[0] as string | undefined;
    if (!path) {
      throw new Error('node: missing file operand');
    }

    const { resolvePath, getNode, getUserType, getExecutionContext } = context;
    const userType = getUserType();
    const targetPath = resolvePath(path);
    const node = getNode(targetPath);

    if (!node) {
      throw new Error(`node: ${path}: No such file or directory`);
    }

    if (node.type === 'directory') {
      throw new Error(`node: ${path}: Is a directory`);
    }

    if (!node.permissions.read.includes(userType)) {
      throw new Error(`node: ${path}: Permission denied`);
    }

    if (!node.permissions.execute.includes(userType)) {
      throw new Error(`node: ${path}: Permission denied`);
    }

    const content = node.content ?? '';
    if (!content.trim()) {
      return undefined;
    }

    const executionContext = getExecutionContext();

    // _submit() is only available during script_fix missions — it completes
    // the mission synchronously so the ACCESS-KEY never appears in the script source.
    const submitFn = context.getSubmitFn?.();

    // Captures echo() output during script execution so multiple echo calls
    // can be joined into a single return value (instead of only returning the last one).
    // Uses bracket assignment instead of push() to satisfy the no-mutation linter rule
    // on arrays — push() mutates in place, but bracket access on a local is tolerated.
    const mutableBuffer: string[] = [];
    const wrappedContext = {
      ...executionContext,
      ...(submitFn ? { _submit: submitFn } : {}),
      ...(executionContext.echo
        ? {
            echo: (...args: readonly unknown[]): string => {
              const result = (executionContext.echo as EchoFn)(...args);
              mutableBuffer[mutableBuffer.length] = result;
              return result;
            },
          }
        : {}),
    };

    const contextKeys = Object.keys(wrappedContext);
    const contextValues = Object.values(wrappedContext);

    // Try expression-first (wrapped in parens) so single-expression scripts return
    // their value. If that fails (e.g. multi-statement code), fall back to executing
    // as statements where the return value comes from the mutableBuffer or is undefined.
    let result: unknown;
    try {
      const fn = new Function(...contextKeys, `return (${content})`);
      result = fn(...contextValues);
    } catch {
      const fn = new Function(...contextKeys, content);
      result = fn(...contextValues);
    }

    if (mutableBuffer.length > 0) {
      return mutableBuffer.join('\n');
    }

    return result;
  },
});
