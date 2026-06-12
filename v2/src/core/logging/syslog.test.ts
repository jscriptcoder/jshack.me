import { describe, expect, it } from 'vitest';
import { derivePid } from './syslog';

/**
 * Shared syslog primitives. The line shape (`formatSyslogTimestamp` /
 * `formatSyslogLine`) is exercised through its consumers' rendered lines
 * (auth.log in `authLog.test.ts`, kern.log in `kernLog.test.ts`); `derivePid`
 * is exported + consumed directly by the auth-log appenders, so it is pinned
 * here as the cosmetic, deterministic pid generator it is.
 */

describe('derivePid', () => {
  it('maps a seed into a plausible 4-digit pid range (1000–9999)', () => {
    expect(derivePid(0)).toBeGreaterThanOrEqual(1000);
    expect(derivePid(1_750_000_123_456)).toBeLessThanOrEqual(9999);
    expect(derivePid(1_750_000_123_456)).toBeGreaterThanOrEqual(1000);
  });

  it('is deterministic for a given seed', () => {
    expect(derivePid(123456)).toBe(derivePid(123456));
  });

  it('varies with the seed', () => {
    expect(derivePid(1000)).not.toBe(derivePid(1001));
  });
});
