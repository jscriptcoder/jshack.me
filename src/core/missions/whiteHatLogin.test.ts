import { describe, expect, it } from 'vitest';
import { whiteHatWord } from './whiteHatLogin.js';
import { md5 } from '../generation/md5.js';
import { DEPLOYMENT_POOLS, DEPLOYMENT_SECRETS, WHITE_HAT_PASSWORDS } from '../../test/passwords.js';

describe('the word a white-hat client hands over', () => {
  it('reads a white-hat hash the build encoded back to its word', () => {
    const word = WHITE_HAT_PASSWORDS[0]!;

    expect(whiteHatWord(md5(word), DEPLOYMENT_SECRETS)).toBe(word);
  });

  // The pools can change after a build. Only a hash the bundle ships may come out, so the words
  // a deployment hands out never drift from the hashes its doors were drawn from.
  it('refuses a word the deployment holds but the build never encoded', () => {
    const unshipped = 'never-encoded-white-hat-word';
    const rawSecrets = JSON.stringify({
      ...DEPLOYMENT_POOLS,
      WHITE_HAT_PASSWORDS: [...WHITE_HAT_PASSWORDS, unshipped],
    });

    expect(whiteHatWord(md5(unshipped), rawSecrets)).toBeNull();
  });
});
