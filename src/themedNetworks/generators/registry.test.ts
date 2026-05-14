import { describe, it, expect } from 'vitest';
import { selectGenerator } from './registry';
import { generateSearchEngineNetwork } from './searchEngineNetwork';
import { generateTechpartsNetwork } from './techpartsNetwork';

describe('selectGenerator — theme dispatch', () => {
  it('dispatches theme "techparts" to generateTechpartsNetwork', () => {
    expect(selectGenerator('techparts')).toBe(generateTechpartsNetwork);
  });

  it('dispatches theme "search-engine" to generateSearchEngineNetwork (regression guard)', () => {
    expect(selectGenerator('search-engine')).toBe(generateSearchEngineNetwork);
  });

  it('falls back to the default mission-shaped generator for unknown themes', () => {
    const unknownThemeGenerator = selectGenerator('made-up-theme');
    expect(unknownThemeGenerator).not.toBe(generateSearchEngineNetwork);
    expect(unknownThemeGenerator).not.toBe(generateTechpartsNetwork);
    expect(typeof unknownThemeGenerator).toBe('function');
  });
});
