import type { Token } from './types';

type QuoteResult = { readonly value: string; readonly end: number };

type WalkState = {
  readonly index: number;
  readonly buffer: string;
  readonly inWord: boolean;
  readonly tokens: readonly Token[];
};

const INITIAL_STATE: WalkState = { index: 0, buffer: '', inWord: false, tokens: [] };

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t';

const readSingleQuoted = (input: string, i: number, acc = ''): QuoteResult => {
  if (i >= input.length) {
    throw new Error('bash: syntax error: unterminated single-quoted string');
  }
  if (input[i] === "'") return { value: acc, end: i + 1 };
  return readSingleQuoted(input, i + 1, acc + input[i]);
};

const readDoubleQuoted = (input: string, i: number, acc = ''): QuoteResult => {
  if (i >= input.length) {
    throw new Error('bash: syntax error: unterminated double-quoted string');
  }
  if (input[i] === '"') return { value: acc, end: i + 1 };
  // Only \" and \\ are escapes inside double quotes in Phase A (no interpolation yet).
  if (input[i] === '\\' && i + 1 < input.length) {
    const next = input[i + 1];
    if (next === '"' || next === '\\') {
      return readDoubleQuoted(input, i + 2, acc + next);
    }
  }
  return readDoubleQuoted(input, i + 1, acc + input[i]);
};

const flushWord = (state: WalkState): WalkState =>
  state.inWord
    ? {
        index: state.index,
        tokens: [...state.tokens, { kind: 'word', value: state.buffer }],
        buffer: '',
        inWord: false,
      }
    : state;

const appendToWord = (state: WalkState, chars: string, advanceBy: number): WalkState => ({
  ...state,
  buffer: state.buffer + chars,
  inWord: true,
  index: state.index + advanceBy,
});

const emitOperator = (state: WalkState, token: Token): WalkState => {
  const flushed = flushWord(state);
  return {
    ...flushed,
    tokens: [...flushed.tokens, token],
    index: state.index + 1,
  };
};

const consume = (input: string, state: WalkState): WalkState => {
  const ch = input[state.index];

  if (ch === "'") {
    const { value, end } = readSingleQuoted(input, state.index + 1);
    return { ...state, buffer: state.buffer + value, inWord: true, index: end };
  }

  if (ch === '"') {
    const { value, end } = readDoubleQuoted(input, state.index + 1);
    return { ...state, buffer: state.buffer + value, inWord: true, index: end };
  }

  if (ch === '\\') {
    if (state.index + 1 >= input.length) {
      throw new Error("bash: syntax error near unexpected token `newline'");
    }
    return appendToWord(state, input[state.index + 1], 2);
  }

  if (ch === '|') return emitOperator(state, { kind: 'pipe' });
  if (ch === '>') return emitOperator(state, { kind: 'redirect' });
  if (isWhitespace(ch)) return { ...flushWord(state), index: state.index + 1 };

  return appendToWord(state, ch, 1);
};

const walk = (input: string, state: WalkState): WalkState =>
  state.index >= input.length ? flushWord(state) : walk(input, consume(input, state));

export const tokenize = (input: string): readonly Token[] => walk(input, INITIAL_STATE).tokens;
