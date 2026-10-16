import { describe, expect, it } from 'vitest';
import { historyLine } from './historyLine.js';

const OURS = `jsc${'a'.repeat(40)}`;
const THEIRS = `jsc${'b'.repeat(40)}`;
const AT = '2026-10-16T09:12:44.000Z';

const linked = (address: string): string => `<a href="/address?a=${address}">${address}</a>`;

describe('historyLine — one transfer as an address sees it', () => {
  it('words coins in, coins out and a mint as `wallet history` prints them', () => {
    expect(historyLine(OURS, { from: THEIRS, to: OURS, amount: 40, at: AT })).toBe(
      `2026-10-16 09:12  +40 JSC  from ${THEIRS}`,
    );
    expect(historyLine(OURS, { from: OURS, to: THEIRS, amount: 40, at: AT })).toBe(
      `2026-10-16 09:12  -40 JSC  to ${THEIRS}`,
    );
    expect(historyLine(OURS, { from: null, to: OURS, amount: 500, at: AT })).toBe(
      '2026-10-16 09:12  +500 JSC  from coinbase',
    );
  });

  it('lets a reader write the address at the other end its own way, and only that address', () => {
    expect(historyLine(OURS, { from: THEIRS, to: OURS, amount: 40, at: AT }, linked)).toBe(
      `2026-10-16 09:12  +40 JSC  from ${linked(THEIRS)}`,
    );
    expect(historyLine(OURS, { from: OURS, to: THEIRS, amount: 40, at: AT }, linked)).toBe(
      `2026-10-16 09:12  -40 JSC  to ${linked(THEIRS)}`,
    );
  });

  it('never writes coinbase as an address, since it is a word and not one', () => {
    expect(historyLine(OURS, { from: null, to: OURS, amount: 500, at: AT }, linked)).toBe(
      '2026-10-16 09:12  +500 JSC  from coinbase',
    );
  });
});
