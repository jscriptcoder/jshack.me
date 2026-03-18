import { describe, it, expect } from 'vitest';
import { parseFtpdState } from './ftpdStateParser';

describe('parseFtpdState', () => {
  it('returns empty array for undefined content', () => {
    expect(parseFtpdState(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseFtpdState('')).toEqual([]);
  });

  it('returns port 21 override for default ftpd pid file', () => {
    expect(parseFtpdState('ftpd:port=21')).toEqual([{ port: 21, service: 'ftp', open: true }]);
  });

  it('returns custom port override', () => {
    expect(parseFtpdState('ftpd:port=2121')).toEqual([{ port: 2121, service: 'ftp', open: true }]);
  });

  it('returns empty array for malformed content', () => {
    expect(parseFtpdState('garbage')).toEqual([]);
    expect(parseFtpdState('ftpd:port=')).toEqual([]);
    expect(parseFtpdState('ftpd:port=abc')).toEqual([]);
  });
});
