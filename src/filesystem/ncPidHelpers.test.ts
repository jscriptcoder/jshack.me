import { describe, it, expect } from 'vitest';
import { parseNcPid } from './ncPidHelpers';

// Pure pidfile parser used by the server's authCreateSession nc-pidfile
// branch (PR 5 of plans/cross-player-base-fs-replication.md). Mirrors
// the client-side parseNcPidContent regex but returns a flat shape
// (port + credentials) instead of NcPortOverride.

describe('parseNcPid', () => {
  it('parses a well-formed pidfile line', () => {
    const result = parseNcPid('nc:port=4444,user=alice,userType=user,home=/home/alice');
    expect(result).toEqual({
      port: 4444,
      username: 'alice',
      userType: 'user',
      homePath: '/home/alice',
    });
  });

  it('parses a root pidfile line', () => {
    const result = parseNcPid('nc:port=31337,user=root,userType=root,home=/root');
    expect(result).toEqual({
      port: 31337,
      username: 'root',
      userType: 'root',
      homePath: '/root',
    });
  });

  it('parses a guest pidfile line', () => {
    const result = parseNcPid('nc:port=8080,user=guest,userType=guest,home=/guest');
    expect(result).toEqual({
      port: 8080,
      username: 'guest',
      userType: 'guest',
      homePath: '/guest',
    });
  });

  it('returns undefined for null content', () => {
    expect(parseNcPid(null)).toBeUndefined();
  });

  it('returns undefined for undefined content', () => {
    expect(parseNcPid(undefined)).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(parseNcPid('')).toBeUndefined();
  });

  it('returns undefined for non-matching prefix', () => {
    expect(parseNcPid('nginx:pid=4444')).toBeUndefined();
  });

  it('returns undefined for missing fields', () => {
    expect(parseNcPid('nc:port=4444,user=alice,userType=user')).toBeUndefined();
  });

  it('returns undefined for fields in wrong order', () => {
    expect(parseNcPid('nc:user=alice,port=4444,userType=user,home=/home/alice')).toBeUndefined();
  });

  it('returns undefined when userType is not root/user/guest', () => {
    expect(parseNcPid('nc:port=4444,user=alice,userType=admin,home=/home/alice')).toBeUndefined();
  });

  it('returns undefined when port is non-numeric', () => {
    expect(parseNcPid('nc:port=abc,user=alice,userType=user,home=/home/alice')).toBeUndefined();
  });

  it('returns undefined when port is below 1', () => {
    expect(parseNcPid('nc:port=0,user=alice,userType=user,home=/home/alice')).toBeUndefined();
  });

  it('returns undefined when port is above 65535', () => {
    expect(parseNcPid('nc:port=70000,user=alice,userType=user,home=/home/alice')).toBeUndefined();
  });

  it('preserves home paths with no commas', () => {
    const result = parseNcPid('nc:port=4444,user=bob,userType=user,home=/home/bob');
    expect(result?.homePath).toBe('/home/bob');
  });

  it('preserves home paths with trailing slashes', () => {
    const result = parseNcPid('nc:port=4444,user=bob,userType=user,home=/home/bob/');
    expect(result?.homePath).toBe('/home/bob/');
  });

  it('returns undefined for completely garbled content', () => {
    expect(parseNcPid('garbled \n random nonsense')).toBeUndefined();
  });
});
