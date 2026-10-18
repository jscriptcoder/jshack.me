import { describe, expect, it } from 'vitest';
import { escapeLogField } from './escapeLogField.js';

/**
 * escapeLogField — how a field a caller typed is written into a log line somebody else
 * reads as evidence. A field sits beside columns the server stamped (a timestamp, a source
 * address, a byte count); with an ordinary separator it could print text that reads as one
 * of them. Anything outside a small safe set is spelled out as `\xNN`, one per UTF-8 byte,
 * the way a web server writes a request line, so the field can never end early.
 */

describe('escapeLogField', () => {
  it('leaves what a real field is made of untouched, so an ordinary log reads as it always has', () => {
    // A path with a query, a Debian version, a package, an account, a machine name, a zone:
    // between them they use every character of the safe set.
    for (const field of [
      '/var/log/auth.log.1',
      '/search?q=map&page=2',
      '/address?a=JSC%20x',
      '1:2.3-4~bpo+1',
      'openssh-server',
      'www-data',
      'alice_rig',
      'pear-tree-house.lan',
    ]) {
      expect(escapeLogField(field)).toBe(field);
    }
  });

  it('passes every character of the safe set, letters and digits at both ends of their ranges', () => {
    expect(escapeLogField('AZaz09/._:+~=?&%-')).toBe('AZaz09/._:+~=?&%-');
  });

  it('spells out each separator a log column could be faked with', () => {
    expect(escapeLogField('/x", 0 bytes')).toBe(String.raw`/x\x22\x2c\x200\x20bytes`);
    expect(escapeLogField("o'brien")).toBe(String.raw`o\x27brien`);
    expect(escapeLogField('[root]')).toBe(String.raw`\x5broot\x5d`);
    expect(escapeLogField('user@10.0.0.9')).toBe(String.raw`user\x4010.0.0.9`);
    expect(escapeLogField('a\tb')).toBe(String.raw`a\x09b`);
  });

  it('spells out the characters just outside the safe set, not only the obvious separators', () => {
    // Each sits next to a safe range or a safe punctuation mark in ASCII order, so a
    // range drawn one character too wide would let it through.
    expect(escapeLogField('@[`{;,<>!#$*()^|}')).toBe(
      String.raw`\x40\x5b\x60\x7b\x3b\x2c\x3c\x3e\x21\x23\x24\x2a\x28\x29\x5e\x7c\x7d`,
    );
  });

  it('spells out a backslash, so an escape in the log can only have come from this rule', () => {
    // A field that already carried the text `\x22` would otherwise read exactly like an
    // escaped quote.
    expect(escapeLogField(String.raw`a\x22`)).toBe(String.raw`a\x5cx22`);
  });

  it('spells out control characters, a line break included, so the field stays on its line', () => {
    expect(escapeLogField('a\nb\r\0')).toBe(String.raw`a\x0ab\x0d\x00`);
  });

  it('spells out a character beyond ASCII one UTF-8 byte at a time', () => {
    expect(escapeLogField('café')).toBe(String.raw`caf\xc3\xa9`);
    // A character outside the basic plane is one character, not two halves.
    expect(escapeLogField('\u{1F600}')).toBe(String.raw`\xf0\x9f\x98\x80`);
  });

  it('writes an empty field as nothing', () => {
    expect(escapeLogField('')).toBe('');
  });
});
