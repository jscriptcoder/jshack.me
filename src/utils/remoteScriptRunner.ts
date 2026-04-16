// Blind remote script execution for script_exec vulnerabilities.
// Executes a script body with a provided command context (same shape as node()'s
// execution context on the target machine). No output is returned — the script
// runs for its side effects only (starting daemons, writing files, etc.).

export type RemoteScriptResult = {
  readonly error: string | null;
};

type CommandContext = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

export const executeScriptOnTarget = (
  scriptBody: string,
  commands: CommandContext,
): RemoteScriptResult => {
  const contextKeys = Object.keys(commands);
  const contextValues = Object.values(commands);

  try {
    // Expression-first, then statement fallback (same strategy as node.ts)
    try {
      const fn = new Function(...contextKeys, `return (${scriptBody})`);
      fn(...contextValues);
    } catch {
      const fn = new Function(...contextKeys, scriptBody);
      fn(...contextValues);
    }
    return { error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
};
