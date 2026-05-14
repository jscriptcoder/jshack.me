import { describe, it, expect } from 'vitest';
import { createLynxCommand } from './lynx';

describe('lynx command', () => {
  describe('argument validation', () => {
    it('throws when no URL is given', () => {
      const lynx = createLynxCommand();
      expect(() => lynx.fn()).toThrow('lynx: missing URL argument');
    });

    it('throws on an empty URL', () => {
      const lynx = createLynxCommand();
      expect(() => lynx.fn('')).toThrow('lynx: missing URL argument');
    });

    it('throws on a URL the parser rejects', () => {
      const lynx = createLynxCommand();
      // Single ":" with no host is unparseable by parseUrl.
      expect(() => lynx.fn(':')).toThrow('lynx: invalid URL: :');
    });
  });

  describe('return shape', () => {
    it('returns a lynx_open discriminator with the canonical URL', () => {
      const lynx = createLynxCommand();
      const result = lynx.fn('http://techparts.io/');
      expect(result).toEqual({ __type: 'lynx_open', url: 'http://techparts.io/' });
    });

    it('canonicalises a shorthand URL by adding the http scheme', () => {
      const lynx = createLynxCommand();
      const result = lynx.fn('192.168.1.1');
      expect(result).toEqual({ __type: 'lynx_open', url: 'http://192.168.1.1/' });
    });

    it('preserves a non-default port', () => {
      const lynx = createLynxCommand();
      const result = lynx.fn('http://findit.io:8080/');
      expect(result).toEqual({ __type: 'lynx_open', url: 'http://findit.io:8080/' });
    });

    it('preserves the query string', () => {
      const lynx = createLynxCommand();
      const result = lynx.fn('http://findit.io/?q=foo');
      expect(result).toEqual({ __type: 'lynx_open', url: 'http://findit.io/?q=foo' });
    });

    it('preserves an explicit path', () => {
      const lynx = createLynxCommand();
      const result = lynx.fn('http://techparts.io/catalog.html');
      expect(result).toEqual({ __type: 'lynx_open', url: 'http://techparts.io/catalog.html' });
    });
  });

  describe('command metadata', () => {
    it('exposes a category of "network"', () => {
      expect(createLynxCommand().category).toBe('network');
    });

    it('exposes a manual with at least one example', () => {
      const manual = createLynxCommand().manual;
      expect(manual?.examples?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
