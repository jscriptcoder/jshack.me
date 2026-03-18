import { describe, it, expect } from 'vitest';
import { parseSshdState } from './sshdStateParser';

describe('parseSshdState', () => {
  it('returns empty array for undefined content', () => {
    expect(parseSshdState(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseSshdState('')).toEqual([]);
  });

  it('returns port 22 override for default sshd pid file', () => {
    expect(parseSshdState('sshd:port=22')).toEqual([
      { port: 22, service: 'ssh', open: true },
    ]);
  });

  it('returns custom port override', () => {
    expect(parseSshdState('sshd:port=2222')).toEqual([
      { port: 2222, service: 'ssh', open: true },
    ]);
  });

  it('returns empty array for malformed content', () => {
    expect(parseSshdState('garbage')).toEqual([]);
    expect(parseSshdState('sshd:port=')).toEqual([]);
    expect(parseSshdState('sshd:port=abc')).toEqual([]);
  });
});
