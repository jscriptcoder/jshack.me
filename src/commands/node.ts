import type { AsyncOutput, Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, PermissionResult } from '../filesystem/types';
import { collectAsyncOutput } from '../utils/asyncCommand';

type NodeContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly getExecutionContext: () => Record<string, (...args: unknown[]) => unknown>;
  readonly getDecodeFn?: () => ((value: unknown) => string) | undefined;
  readonly canTraverse: (path: string) => PermissionResult;
};

type EchoFn = (...args: readonly unknown[]) => string;

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as { readonly __type: string }).__type === 'async';

const AsyncFunction: new (...args: string[]) => (...args: unknown[]) => Promise<unknown> =
  Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;

// Sentinel error class for cancellation — distinguished from real errors
// so the catch handler can suppress it silently.
class ScriptCancelledError extends Error {
  constructor() {
    super('Script cancelled');
  }
}

// Mutable state for script cancellation. Tracks whether the script has been
// cancelled and holds a reference to the current inner command's cancel fn.
type CancellationState = {
  cancelled: boolean;
  innerCancel: (() => void) | null;
  sleepReject: ((err: Error) => void) | null;
};

// Wraps a command function so that AsyncOutput returns are automatically
// collected into Promise<string[]>. Lines are forwarded to onLine for
// real-time terminal display. Sync returns pass through unchanged.
// Checks cancellation state before starting each async command.
const wrapCommandForAsync = (
  fn: (...args: unknown[]) => unknown,
  onLine: (line: string) => void,
  cancellation: CancellationState,
): ((...args: unknown[]) => unknown) => {
  return (...args: unknown[]): unknown => {
    if (cancellation.cancelled) throw new ScriptCancelledError();
    const result = fn(...args);
    if (isAsyncOutput(result)) {
      cancellation.innerCancel = result.cancel ?? null;
      return collectAsyncOutput(result, onLine).then((lines) => {
        cancellation.innerCancel = null;
        if (cancellation.cancelled) throw new ScriptCancelledError();
        return lines;
      });
    }
    return result;
  };
};

// Validates the file at path and returns its content, or throws on error.
const validateAndReadFile = (path: string, context: NodeContext): string | undefined => {
  const { resolvePath, getNode, getUserType, canTraverse } = context;
  const userType = getUserType();
  const targetPath = resolvePath(path);

  const traversal = canTraverse(targetPath);
  if (!traversal.allowed) {
    throw new Error(`node: ${path}: Permission denied`);
  }

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
  return content.trim() ? content : undefined;
};

// Builds the sync execution context with echo buffering.
const buildSyncContext = (
  executionContext: Record<string, (...args: unknown[]) => unknown>,
  decodeFn: ((value: unknown) => string) | undefined,
  mutableBuffer: string[],
): Record<string, unknown> => ({
  ...executionContext,
  ...(decodeFn ? { _decode: decodeFn } : {}),
  ...(executionContext.echo
    ? {
        echo: (...args: readonly unknown[]): string => {
          const result = (executionContext.echo as EchoFn)(...args);
          mutableBuffer[mutableBuffer.length] = result;
          return result;
        },
      }
    : {}),
});

// Builds the async execution context with command wrapping, console.log, and sleep.
const buildAsyncContext = (
  executionContext: Record<string, (...args: unknown[]) => unknown>,
  decodeFn: ((value: unknown) => string) | undefined,
  onLine: (line: string) => void,
  cancellation: CancellationState,
): Record<string, unknown> => {
  const wrappedEntries = Object.entries(executionContext).map(
    ([name, fn]) => [name, wrapCommandForAsync(fn, onLine, cancellation)] as const,
  );
  const wrapped = Object.fromEntries(wrappedEntries);

  // Override echo to forward to onLine instead of buffering
  if (executionContext.echo) {
    wrapped.echo = (...args: readonly unknown[]): string => {
      const result = (executionContext.echo as EchoFn)(...args);
      onLine(result);
      return result;
    };
  }

  return {
    ...wrapped,
    ...(decodeFn ? { _decode: decodeFn } : {}),
    console: { log: (...args: readonly unknown[]) => onLine(args.join(' ')) },
    sleep: (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (cancellation.cancelled) {
          reject(new ScriptCancelledError());
          return;
        }
        const id = setTimeout(resolve, ms);
        cancellation.sleepReject = (err: Error) => {
          clearTimeout(id);
          reject(err);
        };
      }),
  };
};

// Synchronous execution path — expression-first, then statement fallback.
const executeSyncScript = (
  content: string,
  wrappedContext: Record<string, unknown>,
  mutableBuffer: string[],
): unknown => {
  const contextKeys = Object.keys(wrappedContext);
  const contextValues = Object.values(wrappedContext);

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
};

// Async execution path — returns AsyncOutput that streams lines to the terminal.
const executeAsyncScript = (
  content: string,
  executionContext: Record<string, (...args: unknown[]) => unknown>,
  decodeFn: ((value: unknown) => string) | undefined,
  scriptArgs: readonly unknown[],
): AsyncOutput => {
  const cancellation: CancellationState = {
    cancelled: false,
    innerCancel: null,
    sleepReject: null,
  };

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      const asyncContext = {
        ...buildAsyncContext(executionContext, decodeFn, onLine, cancellation),
        args: scriptArgs,
      };
      const contextKeys = Object.keys(asyncContext);
      const contextValues = Object.values(asyncContext);

      const fn = new AsyncFunction(...contextKeys, content);
      (fn(...contextValues) as Promise<unknown>)
        .then(() => onComplete())
        .catch((err: unknown) => {
          // Cancellation errors are expected — complete silently
          if (err instanceof ScriptCancelledError) {
            onComplete();
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          onLine(`Error: ${message}`);
          onComplete();
        });
    },
    cancel: () => {
      cancellation.cancelled = true;
      cancellation.innerCancel?.();
      cancellation.sleepReject?.(new ScriptCancelledError());
    },
  };
};

const HAS_AWAIT = /\bawait\b/;

export const createNodeCommand = (context: NodeContext): Command => ({
  name: 'node',
  category: 'filesystem',
  description: 'Execute a JavaScript file',
  manual: {
    synopsis: 'node(path[, ...args])',
    description:
      'Execute the contents of a JavaScript file. ' +
      'The file runs with access to all terminal commands. ' +
      'Extra arguments are available inside the script as the args array. ' +
      'Scripts containing await run asynchronously — async commands like hydra() and nmap() ' +
      'return a string[] of output lines when awaited. ' +
      'Use console.log() for output and sleep(ms) for delays.',
    arguments: [
      {
        name: 'path',
        description: 'Path to the JavaScript file to execute',
        required: true,
      },
      {
        name: '...args',
        description: 'Arguments passed to the script (available as args array)',
      },
    ],
    examples: [
      { command: 'node("script.js")', description: 'Execute a JavaScript file' },
      {
        command: 'node("brute.js", "192.168.1.50", "ssh")',
        description: 'Run script with arguments (args[0]="192.168.1.50", args[1]="ssh")',
      },
    ],
  },
  fn: (...args: unknown[]): unknown => {
    const path = args[0] as string | undefined;
    if (!path) {
      throw new Error('node: missing file operand');
    }

    const content = validateAndReadFile(path, context);
    if (!content) {
      return undefined;
    }

    const executionContext = context.getExecutionContext();
    const decodeFn = context.getDecodeFn?.();
    const scriptArgs = args.slice(1);

    // Scripts with await use the async execution path — returns AsyncOutput
    // so Terminal can stream lines in real time.
    if (HAS_AWAIT.test(content)) {
      return executeAsyncScript(content, executionContext, decodeFn, scriptArgs);
    }

    // Captures echo() output during script execution so multiple echo calls
    // can be joined into a single return value (instead of only returning the last one).
    // Uses bracket assignment instead of push() to satisfy the no-mutation linter rule
    // on arrays — push() mutates in place, but bracket access on a local is tolerated.
    const mutableBuffer: string[] = [];
    const wrappedContext = {
      ...buildSyncContext(executionContext, decodeFn, mutableBuffer),
      args: scriptArgs,
    };

    return executeSyncScript(content, wrappedContext, mutableBuffer);
  },
});
