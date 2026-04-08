import { guestPasswords, wordlistPasswords } from '../generation/pools';

// Passwords wordlist — installed with hydra via apt.
// Contains guest + wordlist passwords, one per line.
// Hydra reads this file to determine which passwords are crackable.
export const passwordsWordlistContent: string = [...guestPasswords, ...wordlistPasswords].join(
  '\n',
);
