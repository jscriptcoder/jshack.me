// Lightweight script runner for mail verification.
// Executes a script in a sandboxed context with _system() captured.
// Returns the value passed to _system(), or null if _system was never called.

export type ScriptRunnerResult = {
  readonly systemValue: string | null;
  readonly error: string | null;
};

type ScriptRunnerContext = {
  readonly [key: string]: (...args: readonly unknown[]) => unknown;
};

const AsyncFunction: new (...args: string[]) => (...args: unknown[]) => Promise<unknown> =
  Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;

const HAS_AWAIT = /\bawait\b/;

export const runScriptWithSystem = (
  content: string,
  extraContext?: ScriptRunnerContext,
): ScriptRunnerResult | Promise<ScriptRunnerResult> => {
  let captured: string | null = null;

  const systemFn = (value: unknown): string => {
    captured = String(value);
    return `System check: PASS`;
  };

  // No-op echo — scripts may call echo() for error branches, we ignore it during verification
  const echoFn = (): string => '';

  const context: Record<string, unknown> = {
    _system: systemFn,
    echo: echoFn,
    ...extraContext,
  };

  const contextKeys = Object.keys(context);
  const contextValues = Object.values(context);

  // Async scripts (containing await) use AsyncFunction constructor
  if (HAS_AWAIT.test(content)) {
    return (async (): Promise<ScriptRunnerResult> => {
      try {
        const fn = new AsyncFunction(...contextKeys, content);
        await fn(...contextValues);
        return { systemValue: captured, error: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { systemValue: captured, error: captured !== null ? null : message };
      }
    })();
  }

  try {
    // Try expression-first, fall back to statement mode (same strategy as node.ts)
    try {
      const fn = new Function(...contextKeys, `return (${content})`);
      fn(...contextValues);
    } catch {
      const fn = new Function(...contextKeys, content);
      fn(...contextValues);
    }

    return { systemValue: captured, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { systemValue: null, error: message };
  }
};
