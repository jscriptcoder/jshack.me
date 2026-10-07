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
 *   - two ADJACENT `>` are one APPEND OPERATOR token (`a>>b` → word(a), append,
 *     word(b)); `> >` stays two redirects, and `>>>` is an append then a redirect
 *   - inside quotes `|` and `>` are literal characters (`echo "a|b"`,
 *     `echo "a>b"` → one word each)
 *   - an unterminated quote returns `{ ok: false, error: 'syntax error: …' }`
 *   - given a home directory, an UNQUOTED `~` that starts a word and is the whole
 *     word or followed by an unquoted `/` becomes that home (`~`, `~/notes`,
 *     `~/"my notes"`), as bash expands it; `"~"`, `a~`, `~notes` and `~"/x"` stay
 *     literal. No home (a redis line, say) means no expansion at all
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
  | { readonly kind: 'redirect' }
  | { readonly kind: 'append' };

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
  /** the character scanned just before this one, quoted or not */
  readonly previous: string | null;
  /** the current word began with an unquoted `~` that nothing has yet ruled out
   *  as the home directory */
  readonly tildeLead: boolean;
};

const INITIAL_STATE: ScanState = {
  tokens: [],
  buffer: '',
  hasBuffer: false,
  openQuote: null,
  previous: null,
  tildeLead: false,
};

/** Emit any pending word token and reset the buffer. A no-op when no word is
 *  in progress, so flushing on whitespace/pipe/EOF is always safe. */
const flushWord = (state: ScanState, home: string | undefined): ScanState =>
  state.hasBuffer
    ? {
        ...state,
        tokens: [...state.tokens, { kind: 'word', value: expandTilde(state, home) }],
        buffer: '',
        hasBuffer: false,
      }
    : state;

const expandTilde = (state: ScanState, home: string | undefined): string =>
  state.tildeLead && home !== undefined ? home + state.buffer.slice(1) : state.buffer;

/** Whether an unquoted character keeps a leading `~` the home directory: the `~`
 *  itself opens it, and only a `/` straight after it keeps it open — so a quote
 *  there (`~"/x"`) closes it, as bash leaves that literal. */
const leadsWithTilde = (state: ScanState, ch: string): boolean => {
  if (!state.hasBuffer) return ch === '~';
  return state.tildeLead && (state.buffer !== '~' || ch === '/');
};

const scanChar = (state: ScanState, ch: string, home: string | undefined): ScanState => {
  // Inside a quoted segment the closing quote ends it; everything else —
  // including `|` and whitespace — is a literal part of the current word.
  if (state.openQuote !== null) {
    return ch === state.openQuote
      ? { ...state, openQuote: null }
      : { ...state, buffer: state.buffer + ch };
  }
  if (ch === '|') {
    const flushed = flushWord(state, home);
    return { ...flushed, tokens: [...flushed.tokens, { kind: 'pipe' }] };
  }
  if (ch === '>') {
    // Only a `>` IMMEDIATELY after the redirect it continues makes `>>`: whitespace or an
    // empty `""` between them leaves two redirects, which the parser refuses as bash does.
    // A quote can't sit between them unseen — it would be `previous` — so an unquoted
    // `previous` of `>` is always the operator, never a literal.
    const last = state.tokens.at(-1);
    if (state.previous === '>' && last?.kind === 'redirect') {
      return { ...state, tokens: [...state.tokens.slice(0, -1), { kind: 'append' }] };
    }
    const flushed = flushWord(state, home);
    return { ...flushed, tokens: [...flushed.tokens, { kind: 'redirect' }] };
  }
  if (isWhitespace(ch)) {
    return flushWord(state, home);
  }
  if (isQuote(ch)) {
    // An empty `""` still produces a token; flagging the buffer here makes sure
    // it gets flushed at EOF even if no content arrives between quotes.
    return { ...state, openQuote: ch, hasBuffer: true, tildeLead: leadsWithTilde(state, ch) };
  }
  return {
    ...state,
    buffer: state.buffer + ch,
    hasBuffer: true,
    tildeLead: leadsWithTilde(state, ch),
  };
};

export const tokenize = (input: string, home?: string): TokenizeResult => {
  // Spread to chars (not a raw index walk) so multi-unit code points stay whole.
  const scanned = [...input].reduce(
    (state, ch) => ({ ...scanChar(state, ch, home), previous: ch }),
    INITIAL_STATE,
  );

  if (scanned.openQuote !== null) {
    return { ok: false, error: 'syntax error: unexpected end of file' };
  }
  return { ok: true, tokens: flushWord(scanned, home).tokens };
};
