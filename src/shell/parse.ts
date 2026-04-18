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

// Phase B: multi-stage pipelines via `|`. Redirect `>` still rejected until Phase C.
export const parse = (tokens: readonly Token[]): Pipeline => {
  if (tokens.length === 0) return { stages: [] };

  const redirectToken = tokens.find((t) => t.kind === 'redirect');
  if (redirectToken) {
    throw new Error("bash: syntax error near unexpected token `>'");
  }

  const groups = splitByPipe(tokens);
  const emptyGroup = groups.find((g) => g.length === 0);
  if (emptyGroup !== undefined) {
    throw new Error("bash: syntax error near unexpected token `|'");
  }

  return { stages: groups.map(buildStage) };
};
