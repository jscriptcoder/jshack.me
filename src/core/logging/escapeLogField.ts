/**
 * escapeLogField — the one rule for writing a field a caller typed into a log line.
 *
 * A trace line puts the caller's words (a path, an account, a package name, a box's own
 * chosen name) beside columns the server stamped: a timestamp, a source address, a pid, a
 * byte count, a verdict. Those columns are what a defender reads as evidence, so nothing a
 * caller typed may print text that reads as one of them. A quote would close a quoted
 * field early, a space would start a new column in a bare one, and each log format has its
 * own separators, so the rule is not "escape the separators" but the reverse: a character
 * passes only if it is in a small set every real field is made of, and anything else is
 * spelled out as `\xNN`, one per UTF-8 byte, the way a web server writes a request line.
 * The backslash is outside the set, so an escape in a log can only have come from here.
 *
 * Written rather than refused, as a line break is (`appendMachineLog`): the attempt is
 * itself something to record. The rule runs in each formatter, where a field is still a
 * value of its own; by the time a line reaches `appendMachineLog` it is one string and a
 * field cannot be told from the separator beside it.
 */

/** What a path, a Debian version, a package, an account, a machine name and a zone are
 *  made of. Nothing here separates a column in any log the world writes. Tested against one
 *  character at a time, so it needs no anchors. */
const SAFE = /[A-Za-z0-9/._:+~=?&%-]/;

const encoder = new TextEncoder();

const spelledOut = (character: string): string =>
  Array.from(encoder.encode(character), (byte) => `\\x${byte.toString(16).padStart(2, '0')}`).join(
    '',
  );

export const escapeLogField = (field: string): string =>
  Array.from(field, (character) => (SAFE.test(character) ? character : spelledOut(character))).join(
    '',
  );
