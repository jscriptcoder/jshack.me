/**
 * The script host — run a player's JavaScript with a supplied context.
 *
 * Pure over `(source, context)`: it knows nothing about commands, the
 * terminal, or `CommandEnv`. Everything the script can reach is passed in, so
 * a caller that is not the `node` command — a remotely triggered script, say —
 * reuses this host instead of duplicating a second sandbox.
 *
 * There is ONE mode and it is async. Every context value a caller injects may
 * be a promise-returning adapter, so the body is always an async function and
 * `await` always works.
 */

export type ScriptContext = Readonly<Record<string, unknown>>;

export type ScriptOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

/** What a failed script says: `<ErrorName>: <message>`, the shape real node
 *  prints minus the stack trace — which would spill the host's own frames,
 *  and the sandbox's, into a game terminal. A thrown non-Error still gets its
 *  own text rather than being swallowed. */
export const describeScriptError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** The `AsyncFunction` constructor is not a global binding, so it is reached
 *  through an async function's prototype. The assertion names the shape the
 *  language guarantees for it; `Object.getPrototypeOf` can only return
 *  `unknown`-ish here, and there is no typed alternative. */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...argumentNames: readonly string[]
) => (...values: readonly unknown[]) => Promise<unknown>;

export const runScript = async (
  source: string,
  context: ScriptContext,
): Promise<ScriptOutcome> => {
  const names = Object.keys(context);
  try {
    // The script runs inside a BLOCK, not directly as the function body:
    // injected names are the function's own parameters, and a top-level
    // `const console = …` in the body itself would be a redeclaration
    // SyntaxError that kills the script before its first line. Inside a block
    // the same declaration is an ordinary, legal shadow.
    const body = new AsyncFunction(...names, `{\n${source}\n}`);
    await body(...names.map((name) => context[name]));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};
