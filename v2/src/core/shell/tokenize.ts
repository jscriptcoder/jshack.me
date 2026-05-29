/**
 * tokenize — phase 1 of the v2 shell parser.
 *
 * Splits a raw input line into a typed token stream with shell-like quoting:
 *   - whitespace separates tokens
 *   - `"..."` and `'...'` are single tokens; the opposite quote is literal
 *     inside (you can write `"it's"` or `'"foo"'`)
 *   - adjacent quoted/unquoted segments concatenate into one token
 *     (`"a"b"c"` → `abc`, matching real bash)
 *   - an empty quoted string `""` yields an empty word token (NOT no token),
 *     so `echo ""` and `echo` differ in arg count
 *   - `|` outside quotes is a PIPE OPERATOR token, and `>` outside quotes is a
 *     REDIRECT OPERATOR token; both flush any pending word buffer first —
 *     `a|b` → word(a), pipe, word(b); `a>b` → word(a), redirect, word(b)
 *   - inside quotes `|` and `>` are literal characters (`echo "a|b"`,
 *     `echo "a>b"` → one word each)
 *   - an unterminated quote returns `{ ok: false, error: 'syntax error: …' }`
 *
 * The tokenizer emits operator tokens unconditionally — it does NOT reject
 * empty stages (`| a`, `a |`) or a target-less redirect (`a >`). That
 * validation lives in `parsePipeline`.
 *
 * Escape sequences, variable interpolation, and command substitution are out
 * of scope here.
 *
 * Command-agnostic: it never inspects word shape and never reads command
 * flag specs. The binder (`bindFlags`) makes flag-vs-positional decisions
 * afterwards, per stage.
 */

export type Token =
  | { readonly kind: 'word'; readonly value: string }
  | { readonly kind: 'pipe' }
  | { readonly kind: 'redirect' };

export type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: string };

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t';
const isQuote = (ch: string): boolean => ch === '"' || ch === "'";

/** Immutable scanner state, folded over the input one character at a time. */
type ScanState = {
  readonly tokens: readonly Token[];
  readonly buffer: string;
  /** distinguishes "no current token" from "current token is empty (from "")" */
  readonly hasBuffer: boolean;
  /** the quote char that opened the current quoted segment, or null when outside */
  readonly openQuote: string | null;
};

const INITIAL_STATE: ScanState = { tokens: [], buffer: '', hasBuffer: false, openQuote: null };

/** Emit any pending word token and reset the buffer. A no-op when no word is
 *  in progress, so flushing on whitespace/pipe/EOF is always safe. */
const flushWord = (state: ScanState): ScanState =>
  state.hasBuffer
    ? {
        ...state,
        tokens: [...state.tokens, { kind: 'word', value: state.buffer }],
        buffer: '',
        hasBuffer: false,
      }
    : state;

const scanChar = (state: ScanState, ch: string): ScanState => {
  // Inside a quoted segment the closing quote ends it; everything else —
  // including `|` and whitespace — is a literal part of the current word.
  if (state.openQuote !== null) {
    return ch === state.openQuote
      ? { ...state, openQuote: null }
      : { ...state, buffer: state.buffer + ch };
  }
  if (ch === '|') {
    const flushed = flushWord(state);
    return { ...flushed, tokens: [...flushed.tokens, { kind: 'pipe' }] };
  }
  if (ch === '>') {
    const flushed = flushWord(state);
    return { ...flushed, tokens: [...flushed.tokens, { kind: 'redirect' }] };
  }
  if (isWhitespace(ch)) {
    return flushWord(state);
  }
  if (isQuote(ch)) {
    // An empty `""` still produces a token; flagging the buffer here makes sure
    // it gets flushed at EOF even if no content arrives between quotes.
    return { ...state, openQuote: ch, hasBuffer: true };
  }
  return { ...state, buffer: state.buffer + ch, hasBuffer: true };
};

export const tokenize = (input: string): TokenizeResult => {
  // Spread to chars (not a raw index walk) so multi-unit code points stay whole.
  const scanned = [...input].reduce(scanChar, INITIAL_STATE);

  if (scanned.openQuote !== null) {
    return { ok: false, error: 'syntax error: unexpected end of file' };
  }
  return { ok: true, tokens: flushWord(scanned).tokens };
};
