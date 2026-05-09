import { describe, it, expect } from 'vitest';
import { findRedisRequirepass } from './redisConfHelpers';

describe('findRedisRequirepass', () => {
  it('extracts requirepass from a typical config', () => {
    const content = [
      '# Redis configuration',
      'port 6379',
      'requirepass s3cret-pw',
      'bind 0.0.0.0',
    ].join('\n');
    expect(findRedisRequirepass(content)).toBe('s3cret-pw');
  });

  it('returns undefined when requirepass is absent', () => {
    const content = 'port 6379\nbind 0.0.0.0';
    expect(findRedisRequirepass(content)).toBeUndefined();
  });

  it('returns undefined for null content', () => {
    expect(findRedisRequirepass(null)).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(findRedisRequirepass('')).toBeUndefined();
  });

  it('skips commented requirepass lines', () => {
    const content = ['# requirepass commented-out', 'port 6379'].join('\n');
    expect(findRedisRequirepass(content)).toBeUndefined();
  });

  it('returns first uncommented requirepass when both present', () => {
    const content = ['# requirepass disabled', 'requirepass active-pw'].join('\n');
    expect(findRedisRequirepass(content)).toBe('active-pw');
  });

  it('handles leading whitespace on the directive line', () => {
    const content = '   requirepass indented-pw';
    expect(findRedisRequirepass(content)).toBe('indented-pw');
  });

  it('returns undefined when value is empty', () => {
    const content = 'requirepass ';
    expect(findRedisRequirepass(content)).toBeUndefined();
  });

  it('does not match prefix-only directives like requirepass-other', () => {
    const content = 'requirepass-other not-a-real-directive';
    expect(findRedisRequirepass(content)).toBeUndefined();
  });
});
