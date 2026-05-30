/**
 * Tab-completion engine — pure and framework-agnostic, ported from legacy
 * (`src/shell/complete.ts`). It never touches the DOM or any framework: the UI
 * supplies a `CompleteAdapter` (command names, a command lookup, and a view of
 * the current filesystem) and gets back a `CompletionOutcome` describing the
 * replacement line, the new caret position, and the candidate list to display.
 *
 * `classifyCursor` walks the raw input up to the caret — quote-aware, and aware
 * of `|`/`>` operators — to decide whether the cursor sits on a command name, a
 * path argument, or a flag, and to extract the partial token. It does NOT reuse
 * the shell tokenizer: completion needs cursor-position, mid-token, and
 * possibly-unterminated-quote analysis that tokenizing a finished line can't give.
 *
 * v2 differences from legacy: flag candidates come from `command.flags` (the
 * authoritative FlagSpec that `bindFlags`/`runLine` consume), not from manual
 * metadata; and keyword-at-arg0 completion (legacy's `values`) is not ported —
 * no v2 command has a fixed-value first positional yet.
 */

import type { Command } from '../commands/types';

export type CompletionKind = 'command' | 'path' | 'flag';

export type CompleteAdapter = {
  readonly commandNames: readonly string[];
  readonly getCommand: (name: string) => Command | undefined;
  readonly listPath: (absPath: string) => readonly string[] | null;
  readonly isDirectory: (absPath: string) => boolean;
  readonly resolvePath: (path: string) => string;
};

export type CompletionOutcome = {
  readonly kind: CompletionKind;
  readonly matches: readonly string[];
  readonly commonPrefix: string;
  readonly replacement: string;
  readonly newCursorPosition: number;
  readonly displayText: string;
  readonly addTrailingSpace: boolean;
};

export type CursorContext = {
  readonly kind: CompletionKind;
  readonly prefix: string;
  readonly quoteChar: '' | "'" | '"';
  readonly tokenStart: number;
  readonly tokenEnd: number;
};

const isTokenBoundary = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '|' || ch === '>';

// Walk left from cursor until we hit a token boundary or the opening of a quoted string.
// In a quoted context the boundary is the opening quote itself.
const scanQuoteStateUpToCursor = (
  input: string,
  cursorPos: number,
): { readonly quoteChar: '' | "'" | '"'; readonly openPos: number } => {
  let quoteChar: '' | "'" | '"' = '';
  let openPos = -1;

  const advanceFrom = (i: number): { next: number; quote: '' | "'" | '"'; open: number } => {
    const ch = input[i];

    if (quoteChar === '') {
      if (ch === "'" || ch === '"') return { next: i + 1, quote: ch, open: i };
      if (ch === '\\' && i + 1 < cursorPos) return { next: i + 2, quote: '', open: -1 };
      return { next: i + 1, quote: '', open: -1 };
    }

    // Inside single quotes — literal until matching quote.
    if (quoteChar === "'") {
      if (ch === "'") return { next: i + 1, quote: '', open: -1 };
      return { next: i + 1, quote: "'", open: openPos };
    }

    // Inside double quotes — recognize \" and \\ as escapes.
    if (ch === '\\' && i + 1 < cursorPos) {
      const nxt = input[i + 1];
      if (nxt === '"' || nxt === '\\') return { next: i + 2, quote: '"', open: openPos };
    }
    if (ch === '"') return { next: i + 1, quote: '', open: -1 };
    return { next: i + 1, quote: '"', open: openPos };
  };

  let i = 0;
  while (i < cursorPos) {
    const step = advanceFrom(i);
    quoteChar = step.quote;
    openPos = step.open;
    i = step.next;
  }

  return { quoteChar, openPos };
};

const findUnquotedTokenStart = (input: string, cursorPos: number): number => {
  let i = cursorPos;
  while (i > 0 && !isTokenBoundary(input[i - 1])) {
    i -= 1;
  }
  return i;
};

const classifyByContextBefore = (
  input: string,
  tokenStart: number,
  prefix: string,
): CompletionKind => {
  const before = input.slice(0, tokenStart).trimEnd();
  if (before === '' || before.endsWith('|')) return 'command';
  if (before.endsWith('>')) return 'path';
  if (prefix.startsWith('-')) return 'flag';
  return 'path';
};

export const classifyCursor = (input: string, cursorPos: number): CursorContext => {
  const { quoteChar, openPos } = scanQuoteStateUpToCursor(input, cursorPos);

  if (quoteChar !== '') {
    const prefix = input.slice(openPos + 1, cursorPos);
    return {
      kind: classifyByContextBefore(input, openPos, prefix),
      prefix,
      quoteChar,
      tokenStart: openPos,
      tokenEnd: cursorPos,
    };
  }

  const tokenStart = findUnquotedTokenStart(input, cursorPos);
  const prefix = input.slice(tokenStart, cursorPos);
  return {
    kind: classifyByContextBefore(input, tokenStart, prefix),
    prefix,
    quoteChar: '',
    tokenStart,
    tokenEnd: cursorPos,
  };
};

const longestCommonPrefix = (values: readonly string[]): string => {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  const first = values[0];
  return values.slice(1).reduce((shared, value) => {
    let i = 0;
    while (i < shared.length && i < value.length && shared[i] === value[i]) i += 1;
    return shared.slice(0, i);
  }, first);
};

const splitDirectoryAndPrefix = (
  partial: string,
): { readonly directory: string; readonly namePrefix: string } => {
  const lastSlash = partial.lastIndexOf('/');
  if (lastSlash === -1) return { directory: '.', namePrefix: partial };
  return {
    directory: partial.slice(0, lastSlash) || '/',
    namePrefix: partial.slice(lastSlash + 1),
  };
};

const buildReplacement = (
  input: string,
  ctx: CursorContext,
  completedToken: string,
  insertAfterToken = '',
): { replacement: string; newCursorPosition: number } => {
  const before = input.slice(0, ctx.tokenStart);
  const after = input.slice(ctx.tokenEnd);
  const tokenWithQuote =
    ctx.quoteChar !== '' ? `${ctx.quoteChar}${completedToken}` : completedToken;
  const replacement = `${before}${tokenWithQuote}${insertAfterToken}${after}`;
  const newCursorPosition = before.length + tokenWithQuote.length + insertAfterToken.length;
  return { replacement, newCursorPosition };
};

const emptyOutcome = (
  input: string,
  cursorPos: number,
  kind: CompletionKind,
): CompletionOutcome => ({
  kind,
  matches: [],
  commonPrefix: '',
  replacement: input,
  newCursorPosition: cursorPos,
  displayText: '',
  addTrailingSpace: false,
});

const completeCommand = (
  input: string,
  cursorPos: number,
  ctx: CursorContext,
  adapter: CompleteAdapter,
): CompletionOutcome => {
  const matches = adapter.commandNames
    .filter((name) => name.startsWith(ctx.prefix))
    .sort((a, b) => a.localeCompare(b));

  if (matches.length === 0) return emptyOutcome(input, cursorPos, 'command');

  const commonPrefix = longestCommonPrefix(matches);
  const singleMatch = matches.length === 1;
  const completedToken = singleMatch ? matches[0] : commonPrefix;
  const trailing = singleMatch ? ' ' : '';
  const { replacement, newCursorPosition } = buildReplacement(input, ctx, completedToken, trailing);

  return {
    kind: 'command',
    matches,
    commonPrefix,
    replacement,
    newCursorPosition,
    displayText: matches.join(', '),
    addTrailingSpace: singleMatch,
  };
};

const completePath = (
  input: string,
  cursorPos: number,
  ctx: CursorContext,
  adapter: CompleteAdapter,
): CompletionOutcome => {
  const { directory, namePrefix } = splitDirectoryAndPrefix(ctx.prefix);
  const resolvedDir = adapter.resolvePath(directory);
  const entries = adapter.listPath(resolvedDir);
  if (!entries) return emptyOutcome(input, cursorPos, 'path');

  const filtered = entries
    .filter((name) => name.startsWith(namePrefix))
    .sort((a, b) => a.localeCompare(b));

  if (filtered.length === 0) return emptyOutcome(input, cursorPos, 'path');

  const decorated = filtered.map((name) => {
    const entryPath = resolvedDir === '/' ? `/${name}` : `${resolvedDir}/${name}`;
    return adapter.isDirectory(entryPath) ? `${name}/` : name;
  });

  const commonPrefix = longestCommonPrefix(filtered);
  const singleMatch = filtered.length === 1;
  const completedName = singleMatch ? decorated[0] : commonPrefix;
  const pathPrefix = directory === '.' ? '' : ctx.prefix.slice(0, ctx.prefix.lastIndexOf('/') + 1);
  const completedToken = `${pathPrefix}${completedName}`;
  const { replacement, newCursorPosition } = buildReplacement(input, ctx, completedToken);

  return {
    kind: 'path',
    matches: decorated,
    commonPrefix,
    replacement,
    newCursorPosition,
    displayText: decorated.join('  '),
    addTrailingSpace: false,
  };
};

// Scan left from tokenStart back to the start of the current stage (or input / last pipe)
// and extract the first word as the command name.
const findCommandNameForStage = (input: string, tokenStart: number): string | null => {
  const pipeIdx = input.lastIndexOf('|', tokenStart - 1);
  const stageStart = pipeIdx === -1 ? 0 : pipeIdx + 1;
  const stageBeforeToken = input.slice(stageStart, tokenStart).trim();
  if (stageBeforeToken === '') return null;
  const firstWord = stageBeforeToken.split(/\s+/)[0];
  return firstWord || null;
};

const completeFlag = (
  input: string,
  cursorPos: number,
  ctx: CursorContext,
  adapter: CompleteAdapter,
): CompletionOutcome => {
  const commandName = findCommandNameForStage(input, ctx.tokenStart);
  if (!commandName) return emptyOutcome(input, cursorPos, 'flag');
  const command = adapter.getCommand(commandName);

  // v2: flags come from the authoritative FlagSpec, not manual metadata.
  const flags = Object.keys(command?.flags ?? {})
    .filter((name) => name.startsWith(ctx.prefix))
    .sort((a, b) => a.localeCompare(b));

  if (flags.length === 0) return emptyOutcome(input, cursorPos, 'flag');

  const commonPrefix = longestCommonPrefix(flags);
  const singleMatch = flags.length === 1;
  const completedToken = singleMatch ? flags[0] : commonPrefix;
  const trailing = singleMatch ? ' ' : '';
  const { replacement, newCursorPosition } = buildReplacement(input, ctx, completedToken, trailing);

  return {
    kind: 'flag',
    matches: flags,
    commonPrefix,
    replacement,
    newCursorPosition,
    displayText: flags.join(', '),
    addTrailingSpace: singleMatch,
  };
};

export const complete = (
  input: string,
  cursorPos: number,
  adapter: CompleteAdapter,
): CompletionOutcome => {
  const ctx = classifyCursor(input, cursorPos);

  // `classifyCursor` only ever yields command / flag / path, so once the first
  // two are handled, path is the remaining case.
  if (ctx.kind === 'command') return completeCommand(input, cursorPos, ctx, adapter);
  if (ctx.kind === 'flag') return completeFlag(input, cursorPos, ctx, adapter);
  return completePath(input, cursorPos, ctx, adapter);
};
