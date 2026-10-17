import { describe, expect, it } from 'vitest';
import { findSecretLeaks, type BuiltFile } from './findSecretLeaks.js';

/**
 * The check behind the promise the bundle makes: the game ships the uncrackable pool
 * as hashes only, so no uncrackable word may appear in any built file. Lint guards
 * the one import that would put them back; this guards the outcome, whatever route a
 * word took into the build.
 */

const builtFile = (overrides: Partial<BuiltFile> = {}): BuiltFile => ({
  path: 'dist/assets/index.js',
  content: 'const greeting = "hello";',
  ...overrides,
});

describe('findSecretLeaks', () => {
  it('finds nothing in a build that holds no uncrackable word', () => {
    expect(findSecretLeaks(['lanternfly4'], [builtFile()])).toEqual([]);
  });

  it('names the word and the file it appears in', () => {
    const leaky = builtFile({ content: 'const words = ["admin","lanternfly4"];' });

    expect(findSecretLeaks(['lanternfly4'], [leaky])).toEqual([
      { word: 'lanternfly4', path: 'dist/assets/index.js' },
    ]);
  });

  it('finds a word inside a longer string, since a minifier joins what it likes', () => {
    const leaky = builtFile({ content: 'x="lanternfly4hollowmere9"' });

    expect(findSecretLeaks(['lanternfly4', 'hollowmere9'], [leaky])).toEqual([
      { word: 'lanternfly4', path: 'dist/assets/index.js' },
      { word: 'hollowmere9', path: 'dist/assets/index.js' },
    ]);
  });

  it('names every leak at once, file by file, so one fix clears them all', () => {
    const files = [
      builtFile({ path: 'dist/index.html', content: '<p>bracken_22</p>' }),
      builtFile({ path: 'dist/assets/clean.js', content: 'nothing here' }),
      builtFile({ path: 'dist/assets/index.js', content: 'lanternfly4 then bracken_22' }),
    ];

    expect(findSecretLeaks(['lanternfly4', 'bracken_22'], files)).toEqual([
      { word: 'bracken_22', path: 'dist/index.html' },
      { word: 'lanternfly4', path: 'dist/assets/index.js' },
      { word: 'bracken_22', path: 'dist/assets/index.js' },
    ]);
  });

  it('names a word once per file however many times it appears there', () => {
    const leaky = builtFile({ content: 'lanternfly4 lanternfly4 lanternfly4' });

    expect(findSecretLeaks(['lanternfly4'], [leaky])).toEqual([
      { word: 'lanternfly4', path: 'dist/assets/index.js' },
    ]);
  });
});
