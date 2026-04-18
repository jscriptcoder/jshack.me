import type { Pipeline, Stage, Token } from './types';

type WordToken = Extract<Token, { kind: 'word' }>;

const isWord = (token: Token): token is WordToken => token.kind === 'word';

const splitByPipe = (tokens: readonly Token[]): readonly (readonly Token[])[] => {
  const pipeIndices = tokens
    .map((token, i) => (token.kind === 'pipe' ? i : -1))
    .filter((i) => i !== -1);

  if (pipeIndices.length === 0) return [tokens];

  const boundaries = [-1, ...pipeIndices, tokens.length];
  return boundaries.slice(0, -1).map((start, i) => tokens.slice(start + 1, boundaries[i + 1]));
};

const buildStage = (group: readonly Token[]): Stage => {
  const words = group.filter(isWord);
  return { command: words[0].value, args: words.slice(1).map((w) => w.value) };
};

// Strips a trailing redirect from the token stream and returns the path target.
// The redirect may only appear as the last two tokens: `> target`.
const extractRedirect = (
  tokens: readonly Token[],
): { readonly body: readonly Token[]; readonly redirectPath?: string } => {
  const redirectIndex = tokens.findIndex((t) => t.kind === 'redirect');
  if (redirectIndex === -1) return { body: tokens };

  if (redirectIndex === 0) {
    throw new Error("bash: syntax error near unexpected token `>'");
  }

  const afterRedirect = tokens.slice(redirectIndex + 1);
  if (afterRedirect.length === 0) {
    throw new Error("bash: syntax error near unexpected token `newline'");
  }

  const target = afterRedirect[0];
  if (target.kind !== 'word') {
    const symbol = target.kind === 'pipe' ? '|' : '>';
    throw new Error(`bash: syntax error near unexpected token \`${symbol}'`);
  }

  if (afterRedirect.length > 1) {
    const extra = afterRedirect[1];
    const symbol = extra.kind === 'pipe' ? '|' : extra.kind === 'redirect' ? '>' : extra.value;
    throw new Error(`bash: syntax error near unexpected token \`${symbol}'`);
  }

  return { body: tokens.slice(0, redirectIndex), redirectPath: target.value };
};

export const parse = (tokens: readonly Token[]): Pipeline => {
  if (tokens.length === 0) return { stages: [] };

  const { body, redirectPath } = extractRedirect(tokens);

  const groups = splitByPipe(body);
  const emptyGroup = groups.find((g) => g.length === 0);
  if (emptyGroup !== undefined) {
    throw new Error("bash: syntax error near unexpected token `|'");
  }

  // A redirect on an earlier stage (before a pipe) also lands as an empty-group issue above,
  // but we re-check any leftover redirect/pipe token to be sure.
  const leftoverOperator = body.find((t) => t.kind === 'pipe' || t.kind === 'redirect');
  if (leftoverOperator && leftoverOperator.kind === 'redirect') {
    throw new Error("bash: syntax error near unexpected token `>'");
  }

  const pipeline: Pipeline = { stages: groups.map(buildStage) };
  return redirectPath !== undefined ? { ...pipeline, redirect: { path: redirectPath } } : pipeline;
};
