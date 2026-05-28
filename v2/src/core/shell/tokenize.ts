/**
 * tokenize — Slice 1 of the v2 shell parser.
 *
 * Splits a raw input line into whitespace-separated tokens. Quoted strings
 * arrive in Slice 3, which reshapes the return type to a Result so the
 * unterminated-quote error can flow through to the dispatcher.
 *
 * Command-agnostic by design: it never inspects token shape and never reads
 * command flag specs. The binder (`bindFlags`) makes flag-vs-positional
 * decisions afterwards, using the dispatched command's declared FlagSpec.
 */

export const tokenize = (input: string): readonly string[] => {
  // `\S+` runs are the whitespace-separated tokens; no match ⇒ blank line.
  return input.match(/\S+/g) ?? [];
};
