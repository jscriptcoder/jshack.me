/**
 * How a script's values become text — one formatter, shared by everything a
 * script can print or write to a file, so the same value never renders two
 * ways.
 *
 * Three rules, in order:
 * - a string passes through untouched;
 * - an array of strings joins with newlines, so captured command output reads
 *   as the lines the player would have seen rather than as a JSON array;
 * - anything else is JSON, because `[object Object]` tells a player nothing
 *   about what their script just found.
 */

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((element) => typeof element === 'string');

export const formatScriptValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (isStringArray(value)) return value.join('\n');

  // `JSON.stringify` answers `undefined` for `undefined`, functions and
  // symbols; those fall back to their own text so a script never prints
  // nothing where it asked to print something.
  const json: string | undefined = JSON.stringify(value);
  return json === undefined ? String(value) : json;
};
