/**
 * tokenize — phase 1 of the v2 shell parser.
 *
 * Splits a raw input line into tokens with shell-like quoting semantics:
 *   - whitespace separates tokens
 *   - `"..."` and `'...'` are single tokens; the opposite quote is literal
 *     inside (you can write `"it's"` or `'"foo"'`)
 *   - adjacent quoted/unquoted segments concatenate into one token
 *     (`"a"b"c"` → `abc`, matching real bash)
 *   - an empty quoted string `""` yields an empty token (NOT no token), so
 *     `echo ""` and `echo` differ in arg count even though the rendered
 *     output is the same
 *   - an unterminated quote returns `{ ok: false, error: 'syntax error: …' }`
 *
 * Pipes, redirects, escape sequences, variable interpolation, and command
 * substitution are out of scope here.
 *
 * Command-agnostic: it never inspects token shape and never reads command
 * flag specs. The binder (`bindFlags`) makes flag-vs-positional decisions
 * afterwards.
 */

export type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly string[] }
  | { readonly ok: false; readonly error: string };

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t';
const isQuote = (ch: string): boolean => ch === '"' || ch === "'";

export const tokenize = (input: string): TokenizeResult => {
  const tokens: string[] = [];
  let buffer = '';
  /** distinguishes "no current token" from "current token is empty (from "")" */
  let hasBuffer = false;
  /** the quote char that opened the current quoted segment, or null when outside */
  let openQuote: string | null = null;

  for (const ch of input) {
    if (openQuote !== null) {
      if (ch === openQuote) {
        openQuote = null;
        continue;
      }
      buffer += ch;
      continue;
    }
    if (isWhitespace(ch)) {
      if (hasBuffer) {
        tokens.push(buffer);
        buffer = '';
        hasBuffer = false;
      }
      continue;
    }
    if (isQuote(ch)) {
      openQuote = ch;
      // An empty `""` still produces a token; flagging the buffer here makes
      // sure it gets flushed at EOF even if no content arrives between quotes.
      hasBuffer = true;
      continue;
    }
    buffer += ch;
    hasBuffer = true;
  }

  if (openQuote !== null) {
    return { ok: false, error: 'syntax error: unexpected end of file' };
  }
  if (hasBuffer) {
    tokens.push(buffer);
  }
  return { ok: true, tokens };
};
