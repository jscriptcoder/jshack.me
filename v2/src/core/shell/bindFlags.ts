/**
 * bindFlags — Slice 1 of the v2 shell parser.
 *
 * Given the tokens AFTER the command name plus the command's flag spec,
 * classify each token as either a flag (with its value, eventually) or a
 * positional argument. Returns a Result so the dispatcher can surface
 * unknown-flag errors as terminal output (exit 2) without throwing.
 *
 * Slice 1 supports boolean flags only. String flags arrive in Slice 2,
 * per-command stacking in Slice 4, and the `--` end-of-options sentinel
 * in Slice 5.
 *
 * Strictness: any dash-prefixed token not declared as `'boolean'` in the
 * spec is an error — except for a bare `-` (POSIX convention for stdin),
 * which is always positional regardless of the spec.
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

  for (const token of args) {
    if (!isFlagToken(token)) {
      positional.push(token);
      continue;
    }
    if (spec[token] === 'boolean') {
      flags.set(token, true);
      continue;
    }
    // Either not in the spec or declared with a type Slice 1 doesn't yet
    // support (`'string'` lands in Slice 2). Strict — stop here.
    return { ok: false, error: `unrecognized option: ${token}` };
  }

  return { ok: true, positional, flags };
};
