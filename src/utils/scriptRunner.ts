// Lightweight script runner for mail verification.
// Executes a script in a sandboxed context with _system() captured.
// Returns the value passed to _system(), or null if _system was never called.

type ScriptRunnerResult = {
  readonly systemValue: string | null;
  readonly error: string | null;
};

export const runScriptWithSystem = (content: string): ScriptRunnerResult => {
  let captured: string | null = null;

  const systemFn = (value: unknown): string => {
    captured = String(value);
    return `System check: PASS`;
  };

  // No-op echo — scripts may call echo() for error branches, we ignore it during verification
  const echoFn = (): string => '';

  try {
    const contextKeys = ['_system', 'echo'];
    const contextValues = [systemFn, echoFn];

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
