/**
 * bindFlags — phases 1–2 of the v2 shell parser.
 *
 * Given the tokens AFTER the command name plus the command's flag spec,
 * classify each token as a boolean flag, a string flag (consuming the
 * next token as its value), or a positional argument. Returns a Result
 * so the dispatcher can surface unknown-flag and missing-value errors as
 * terminal output (exit 2) without throwing.
 *
 * Slice 1 added boolean flags + strict unknown errors. Slice 2 adds
 * `'string'`-typed flags with POSIX consume-next semantics. Stacking
 * arrives in Slice 4 and the `--` end-of-options sentinel in Slice 5.
 *
 * Strictness:
 * - Any dash-prefixed token not in the spec is `unrecognized option`.
 * - A `'string'` flag with no following token is `option requires an
 *   argument`.
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

export const bindFlags = (args: readonly string[], spec: FlagSpec): BindResult => {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!isFlagToken(token)) {
      positional.push(token);
      continue;
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
      // even if it looks like a flag (`-n -5`, `-n -v`). Users who want a
      // dash-prefixed positional after a string flag will use `--` (Slice 5).
      flags.set(token, next);
      i += 1; // step past the value token; the for-loop's i++ then advances normally
      continue;
    }
    return { ok: false, error: `unrecognized option: ${token}` };
  }

  return { ok: true, positional, flags };
};
