import { useCallback } from 'react';
import type { UserType } from '../session/SessionContext';
import type { FileNode } from '../filesystem/types';

type PathCompletionResult = {
  readonly matches: readonly string[];
  readonly displayText: string;
  readonly replacement: string;
  readonly newCursorPosition: number;
};

type StringContext = {
  readonly inString: boolean;
  readonly quoteChar: string;
  readonly contentStart: number;
};

const detectStringContext = (input: string, cursorPosition: number): StringContext => {
  let inString = false;
  let quoteChar = '';
  let contentStart = 0;

  for (let i = 0; i < cursorPosition; i++) {
    const char = input[i];
    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      quoteChar = char;
      contentStart = i + 1;
    } else if (inString && char === quoteChar && input[i - 1] !== '\\') {
      inString = false;
      quoteChar = '';
    }
  }

  return { inString, quoteChar, contentStart };
};

const splitPathAndPrefix = (
  partial: string,
): { readonly directory: string; readonly prefix: string } => {
  const lastSlash = partial.lastIndexOf('/');
  if (lastSlash === -1) return { directory: '.', prefix: partial };
  return {
    directory: partial.slice(0, lastSlash) || '/',
    prefix: partial.slice(lastSlash + 1),
  };
};

const getLongestCommonPrefix = (names: readonly string[]): string => {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';

  const first = names[0] ?? '';
  let prefix = first;

  for (const name of names.slice(1)) {
    while (!name.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix === '') return '';
  }

  return prefix;
};

export const usePathAutoComplete = ({
  listDirectory,
  getNode,
  resolvePath,
  userType,
}: {
  readonly listDirectory: (path: string, userType: UserType) => string[] | null;
  readonly getNode: (path: string) => FileNode | null;
  readonly resolvePath: (path: string) => string;
  readonly userType: UserType;
}) => {
  const getPathCompletions = useCallback(
    (input: string, cursorPosition: number): PathCompletionResult | null => {
      const ctx = detectStringContext(input, cursorPosition);
      if (!ctx.inString) return null;

      const partial = input.slice(ctx.contentStart, cursorPosition);
      const { directory, prefix } = splitPathAndPrefix(partial);

      const resolvedDir = resolvePath(directory);
      const entries = listDirectory(resolvedDir, userType);
      if (!entries) return null;

      const filtered = entries
        .filter((name) => name.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b));

      if (filtered.length === 0) return null;

      const decoratedMatches = filtered.map((name) => {
        const entryPath = resolvedDir === '/' ? `/${name}` : `${resolvedDir}/${name}`;
        const node = getNode(entryPath);
        return node?.type === 'directory' ? `${name}/` : name;
      });

      const commonPrefix = getLongestCommonPrefix(filtered);
      const completedName =
        filtered.length === 1 ? (decoratedMatches[0] ?? commonPrefix) : commonPrefix;

      const pathPrefix = directory === '.' ? '' : partial.slice(0, partial.lastIndexOf('/') + 1);
      const completed = `${pathPrefix}${completedName}`;

      const before = input.slice(0, ctx.contentStart);
      const after = input.slice(cursorPosition);
      const replacement = `${before}${completed}${after}`;
      const newCursorPosition = ctx.contentStart + completed.length;

      return {
        matches: decoratedMatches,
        displayText: decoratedMatches.join('  '),
        replacement,
        newCursorPosition,
      };
    },
    [listDirectory, getNode, resolvePath, userType],
  );

  return { getPathCompletions };
};
