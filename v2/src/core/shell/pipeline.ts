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
 * Redirects are out of scope here — the redirections chunk will strip a
 * trailing redirect target before pipe-splitting (see legacy `parse.ts`).
 */

import type { Token } from './tokenize';

type WordToken = Extract<Token, { readonly kind: 'word' }>;

export type Stage = {
  readonly name: string;
  readonly args: readonly string[];
};

export type Pipeline = {
  readonly stages: readonly Stage[];
};

export type ParsePipelineResult =
  | { readonly ok: true; readonly pipeline: Pipeline }
  | { readonly ok: false; readonly error: string };

const PIPE_SYNTAX_ERROR = "syntax error near unexpected token `|'";

/** Split the token stream into groups of word tokens delimited by pipe
 *  operators. Folds left: a pipe starts a fresh (initially empty) group; any
 *  other token appends to the current group. A pipe at the edge or two in a
 *  row leaves an empty group, which the caller rejects. In the append branch
 *  `token` is narrowed to a word (the pipe case is already handled), so no
 *  type-narrowing filter is needed. */
const splitByPipe = (tokens: readonly Token[]): readonly (readonly WordToken[])[] =>
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
  if (tokens.length === 0) {
    return { ok: true, pipeline: { stages: [] } };
  }

  const groups = splitByPipe(tokens);
  if (groups.some((group) => group.length === 0)) {
    return { ok: false, error: PIPE_SYNTAX_ERROR };
  }

  return { ok: true, pipeline: { stages: groups.map(buildStage) } };
};
