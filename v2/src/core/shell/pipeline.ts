/**
 * parsePipeline — phase 2 of the v2 shell parser.
 *
 * Turns a flat `Token` stream into a `Pipeline` of stages, splitting on pipe
 * operators. Each stage is the command name plus its raw argument strings;
 * flag binding happens later, per stage, in `runCommandLine`.
 *
 * An empty stage — a pipe with no command on one side (`| a`, `a |`,
 * `a || b`) — is a syntax error, matching bash:
 *   `bash: syntax error near unexpected token \`|'`
 * The error is returned WITHOUT the `bash:` prefix; `runCommandLine` adds it,
 * mirroring how it wraps tokenizer errors.
 *
 * No tokens → an empty pipeline (a blank input line is a no-op, exit 0).
 *
 * A trailing `> target` redirect is stripped FIRST (before pipe-splitting) and
 * surfaced as `pipeline.redirect`. It may only appear as the last two tokens:
 *   - a leading `>` (no command) → ``syntax error near unexpected token `>'``
 *   - no target after `>`        → ``syntax error near unexpected token `newline'``
 *   - target is an operator, or any extra token follows it (e.g. a redirect
 *     before a pipe, `echo > f | cat`) → the offending token's symbol.
 * `runCommandLine` consumes `redirect` to write the final stage's stdout to the
 * file instead of the terminal.
 */

import type { Token } from './tokenize';

type WordToken = Extract<Token, { readonly kind: 'word' }>;
/** A token that can appear in the pipe-split BODY — everything except the
 *  redirect operator, which `extractRedirect` strips off first. */
type BodyToken = Exclude<Token, { readonly kind: 'redirect' }>;

export type Stage = {
  readonly name: string;
  readonly args: readonly string[];
};

export type Pipeline = {
  readonly stages: readonly Stage[];
  readonly redirect?: { readonly path: string };
};

export type ParsePipelineResult =
  | { readonly ok: true; readonly pipeline: Pipeline }
  | { readonly ok: false; readonly error: string };

const PIPE_SYNTAX_ERROR = "syntax error near unexpected token `|'";

const syntaxErrorNear = (symbol: string): string =>
  `syntax error near unexpected token \`${symbol}'`;

/** The bash symbol a non-word token presents in an error message. */
const symbolOf = (token: Token): string => (token.kind === 'pipe' ? '|' : '>');

type ExtractRedirectResult =
  | { readonly ok: true; readonly body: readonly BodyToken[]; readonly path?: string }
  | { readonly ok: false; readonly error: string };

/** Strip a trailing `> target` from the token stream. The redirect may only
 *  appear as the last two tokens; anything else is a syntax error (mirrors
 *  bash's "unexpected token" reporting). */
const extractRedirect = (tokens: readonly Token[]): ExtractRedirectResult => {
  const redirectIndex = tokens.findIndex((token) => token.kind === 'redirect');
  // No redirect token at all ⇒ the whole stream is redirect-free body. The
  // assertion narrows the element type on an invariant `findIndex` just proved.
  if (redirectIndex === -1) return { ok: true, body: tokens as readonly BodyToken[] };

  if (redirectIndex === 0) return { ok: false, error: syntaxErrorNear('>') };

  const afterRedirect = tokens.slice(redirectIndex + 1);
  if (afterRedirect.length === 0) return { ok: false, error: syntaxErrorNear('newline') };

  const target = afterRedirect[0];
  if (target.kind !== 'word') return { ok: false, error: syntaxErrorNear(symbolOf(target)) };

  if (afterRedirect.length > 1) {
    const extra = afterRedirect[1];
    return {
      ok: false,
      error: syntaxErrorNear(extra.kind === 'word' ? extra.value : symbolOf(extra)),
    };
  }

  // Everything before the FIRST redirect is redirect-free body (a second
  // redirect would have surfaced as the extra-token error above).
  return {
    ok: true,
    body: tokens.slice(0, redirectIndex) as readonly BodyToken[],
    path: target.value,
  };
};

/** Split the token stream into groups of word tokens delimited by pipe
 *  operators. Folds left: a pipe starts a fresh (initially empty) group; any
 *  other token appends to the current group. A pipe at the edge or two in a
 *  row leaves an empty group, which the caller rejects. In the append branch
 *  `token` is narrowed to a word (the pipe case is already handled), so no
 *  type-narrowing filter is needed. */
const splitByPipe = (tokens: readonly BodyToken[]): readonly (readonly WordToken[])[] =>
  tokens.reduce<readonly (readonly WordToken[])[]>(
    (groups, token) => {
      if (token.kind === 'pipe') return [...groups, []];
      const current = groups[groups.length - 1];
      return [...groups.slice(0, -1), [...current, token]];
    },
    [[]],
  );

const buildStage = (group: readonly WordToken[]): Stage => ({
  name: group[0].value,
  args: group.slice(1).map((token) => token.value),
});

export const parsePipeline = (tokens: readonly Token[]): ParsePipelineResult => {
  const extracted = extractRedirect(tokens);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  // An empty body means no command tokens (a blank line, possibly all consumed
  // by an earlier error path). A leading `>` already errored in extractRedirect,
  // so an empty body never carries a redirect path.
  if (extracted.body.length === 0) {
    return { ok: true, pipeline: { stages: [] } };
  }

  const groups = splitByPipe(extracted.body);
  if (groups.some((group) => group.length === 0)) {
    return { ok: false, error: PIPE_SYNTAX_ERROR };
  }

  const stages = groups.map(buildStage);
  return {
    ok: true,
    pipeline:
      extracted.path !== undefined ? { stages, redirect: { path: extracted.path } } : { stages },
  };
};
