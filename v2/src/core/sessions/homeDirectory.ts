/**
 * Where an account lands: `/root` for root, `/home/<user>` for everyone else.
 *
 * One rule, one place. It decides the cwd after an `ssh` hop, after `su`, after a
 * refresh rebuilds the stack, where a bare `cd` returns to, and where an ftp
 * session starts on the target — and those must agree, or a player is put
 * somewhere their own box says they do not live.
 */

import { asAbsPath, type AbsPath, type UserType } from '../types';

/** Structural on purpose: a `Session` satisfies it, and so does a freshly
 *  authenticated account that has no session row yet. */
export type HomeAccount = {
  readonly username: string;
  readonly userType: UserType;
};

export const homeDirectory = ({ username, userType }: HomeAccount): AbsPath =>
  userType === 'root' ? asAbsPath('/root') : asAbsPath(`/home/${username}`);
