import { useCallback } from 'react';

export type CompletionMatch = {
  readonly name: string;
  readonly display: string;
};

export type CompletionResult = {
  readonly matches: readonly CompletionMatch[];
  readonly displayText: string; // comma-separated list
  readonly commonPrefix: string; // longest common prefix of all match names
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

export const useAutoComplete = (
  commandNames: readonly string[],
  variableNames: readonly string[] = [],
) => {
  const getCompletions = useCallback(
    (input: string): CompletionResult => {
      const trimmed = input.trim();

      if (!trimmed) {
        return { matches: [], displayText: '', commonPrefix: '' };
      }

      const allNames = [...commandNames, ...variableNames];
      const allItems = allNames.map((name) => ({ name, display: name }));

      const matches = allItems
        .filter((item) => item.name.toLowerCase().startsWith(trimmed.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));

      const displayText = matches.map((m) => m.display).join(', ');
      const commonPrefix = getLongestCommonPrefix(matches.map((m) => m.name));

      return { matches, displayText, commonPrefix };
    },
    [commandNames, variableNames],
  );

  return {
    getCompletions,
  };
};
