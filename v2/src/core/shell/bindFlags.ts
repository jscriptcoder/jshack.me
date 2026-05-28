/**
 * bindFlags — the v2 shell parser's flag-binding phase (feature-complete).
 *
 * Given the tokens AFTER the command name plus the command's flag spec,
 * classify each token as a boolean flag, a string flag (consuming the
 * next token as its value), or a positional argument. Returns a Result
 * so the dispatcher can surface unknown-flag and missing-value errors as
 * terminal output (exit 2) without throwing.
 *
 * Slice 1 added boolean flags + strict unknown errors. Slice 2 adds
 * `'string'`-typed flags with POSIX consume-next semantics. Slice 4 adds
 * per-command opt-in short-flag stacking (`ls -la` ≡ `ls -l -a`). Slice
 * 5 adds the `--` end-of-options sentinel.
 *
 * Strictness:
 * - Any dash-prefixed token not in the spec is `unrecognized option`.
 * - A `'string'` flag with no following token is `option requires an
 *   argument`.
 * - When stacking is enabled, expansion is a FALLBACK after a literal
 *   spec miss, ALL-OR-NOTHING (every char must be a boolean flag in the
 *   spec, otherwise the whole original token is rejected verbatim).
 * - `--` ends option parsing — every subsequent token is positional,
 *   even if it looks like a flag. EXCEPT when a string flag is awaiting
 *   its value: consume-next runs FIRST, so `-o --` binds `--` as the
 *   value of `-o` and does NOT arm the sentinel.
 * - Bare `-` (single dash) is always positional — POSIX shorthand for
 *   stdin — regardless of the spec.
 */

export type FlagSpec = Readonly<Record<string, 'boolean' | 'string'>>;

export type BindResult =
  | {
      readonly ok: true;
      readonly positional: readonly string[];
      readonly flags: ReadonlyMap<string, string | true>;
    }
  | { readonly ok: false; readonly error: string };

/** A bare `-` (single dash) is not a flag — it's POSIX shorthand for stdin. */
const isFlagToken = (token: string): boolean => token.startsWith('-') && token !== '-';

/** Attempt to split `-abc` into `-a` + `-b` + `-c` and register all of them.
 *  Two-pass: verify every member is a declared boolean flag FIRST, then
 *  commit. Returns false on any miss; on false the caller emits the
 *  unrecognized-option error naming the ORIGINAL stacked token.
 *
 *  A single-char `token` (e.g. `-x` where `-x` is unknown) is handled by
 *  the verify loop: `spec[-x]` misses (since literal lookup already did),
 *  the loop returns false, and the original token gets the error. We
 *  rely on the upstream `isFlagToken` filter to keep bare `-` out. */
const tryExpandStack = (
  token: string,
  spec: FlagSpec,
  flags: Map<string, string | true>,
): boolean => {
  const chars = token.slice(1);
  for (const char of chars) {
    if (spec[`-${char}`] !== 'boolean') return false;
  }
  for (const char of chars) {
    flags.set(`-${char}`, true);
  }
  return true;
};

export const bindFlags = (
  args: readonly string[],
  spec: FlagSpec,
  options: { readonly stacking?: boolean } = {},
): BindResult => {
  const stacking = options.stacking ?? false;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!isFlagToken(token)) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      // End-of-options sentinel — every remaining token is positional,
      // INCLUDING further `--` (only the first sentinel is consumed).
      for (let j = i + 1; j < args.length; j += 1) {
        positional.push(args[j]);
      }
      break;
    }
    const declared = spec[token];
    if (declared === 'boolean') {
      flags.set(token, true);
      continue;
    }
    if (declared === 'string') {
      const next = args[i + 1];
      if (next === undefined) {
        return { ok: false, error: `option requires an argument: ${token}` };
      }
      // POSIX consume-next is unconditional: the next token IS the value,
      // even if it looks like a flag (`-n -5`, `-n -v`) or the sentinel
      // (`-o --`). Users who want a dash-prefixed positional after a
      // string flag will need a second `--` later in the line.
      flags.set(token, next);
      i += 1; // step past the value token; the for-loop's i++ then advances normally
      continue;
    }
    if (stacking && tryExpandStack(token, spec, flags)) {
      continue;
    }
    return { ok: false, error: `unrecognized option: ${token}` };
  }

  return { ok: true, positional, flags };
};
