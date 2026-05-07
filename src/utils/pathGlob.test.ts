import { describe, it, expect } from 'vitest';
import { compileGlobPattern, matchesAnyGlobPattern } from './pathGlob';

describe('compileGlobPattern', () => {
  it('matches a literal path with no wildcards', () => {
    expect(compileGlobPattern('/etc/passwd').test('/etc/passwd')).toBe(true);
    expect(compileGlobPattern('/etc/passwd').test('/etc/passwd/extra')).toBe(false);
  });

  it('treats `*` as a single-segment wildcard (no slashes)', () => {
    const re = compileGlobPattern('/var/run/*.pid');
    expect(re.test('/var/run/sshd.pid')).toBe(true);
    expect(re.test('/var/run/nc-31337.pid')).toBe(true);
    // `*` must not match across `/` — a deeper path is rejected.
    expect(re.test('/var/run/sub/sshd.pid')).toBe(false);
  });

  it('treats `**` as a recursive wildcard (matches across slashes)', () => {
    const re = compileGlobPattern('/var/www/**');
    expect(re.test('/var/www/index.html')).toBe(true);
    expect(re.test('/var/www/site/admin/login.html')).toBe(true);
  });

  it('escapes regex metacharacters in literal segments', () => {
    const re = compileGlobPattern('/etc/foo.bar+baz');
    expect(re.test('/etc/foo.bar+baz')).toBe(true);
    // `.` is literal — does NOT match any single char.
    expect(re.test('/etc/fooXbar+baz')).toBe(false);
    // `+` is literal — does NOT mean "1 or more."
    expect(re.test('/etc/foo.barbaz')).toBe(false);
  });

  it('matches a pattern with mixed `*` and `**` (** is "any chars incl. /", NOT "zero or more segments")', () => {
    const re = compileGlobPattern('/a/**/x/*.log');
    // Requires a non-empty prefix between /a/ and /x/ — `**` compiles to
    // `.*` and the literal /x/ then needs a / immediately before it.
    expect(re.test('/a/b/x/foo.log')).toBe(true);
    expect(re.test('/a/b/c/x/bar.log')).toBe(true);
    // No prefix between /a/ and /x/ → no match (.* is followed by literal `/x/`).
    expect(re.test('/a/x/foo.log')).toBe(false);
    // `*` (segment wildcard) doesn't cross `/`, so the basename can't have a slash.
    expect(re.test('/a/b/x/sub/foo.log')).toBe(false);
  });
});

describe('matchesAnyGlobPattern', () => {
  it('returns true if any pattern matches the path', () => {
    const patterns = ['/etc/passwd', '/var/run/*.pid'];
    expect(matchesAnyGlobPattern('/etc/passwd', patterns)).toBe(true);
    expect(matchesAnyGlobPattern('/var/run/nc-4444.pid', patterns)).toBe(true);
  });

  it('returns false if no pattern matches', () => {
    const patterns = ['/etc/passwd', '/var/run/*.pid'];
    expect(matchesAnyGlobPattern('/root/.bashrc', patterns)).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesAnyGlobPattern('/anything', [])).toBe(false);
  });
});
