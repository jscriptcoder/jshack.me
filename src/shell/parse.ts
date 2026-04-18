import type { Pipeline, Stage, Token } from './types';

const operatorSymbol = (token: Token): string | null => {
  if (token.kind === 'pipe') return '|';
  if (token.kind === 'redirect') return '>';
  return null;
};

// Phase A: single command only. Pipes and redirects are rejected until Phases B/C enable them.
export const parse = (tokens: readonly Token[]): Pipeline => {
  if (tokens.length === 0) return { stages: [] };

  const badOperator = tokens.map(operatorSymbol).find((sym): sym is string => sym !== null);
  if (badOperator) {
    throw new Error(`bash: syntax error near unexpected token \`${badOperator}'`);
  }

  const words = tokens.map((t) => (t as Extract<Token, { kind: 'word' }>).value);
  const stage: Stage = { command: words[0], args: words.slice(1) };
  return { stages: [stage] };
};
