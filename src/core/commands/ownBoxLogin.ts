/**
 * A login through a door — `ssh`, `scp` or `ftp` — to the box the shell stands on, at
 * home.
 *
 * The client holds the player's own box whole, so, like an own-box `su`, the login is
 * answered here from the box's own tree rather than by a server that would only be
 * reading the same journal back. The three doors differ in what they do once they are
 * in; who gets in, and what the box writes about it, is one rule for all of them.
 */

import { md5 } from '../generation/md5.js';
import { connectedWlan0, ownBoxSource } from '../network/interfaces.js';
import { accountIn } from '../sessions/passwdAccount.js';
import type { UserType } from '../types.js';
import type { AuthLogEvent, CommandEnv } from './types.js';

type OwnBoxDoor = Extract<AuthLogEvent, { readonly kind: 'doorLogin' }>['door'];

/**
 * The address a door's visit to the player's own box comes FROM, or null when `target`
 * does not name that box from where the shell stands.
 *
 * Only at home: on a hop, `localhost` names the hop, and the tree held here is not the
 * one being knocked on. Asked before anything about the network, because loopback needs
 * none — it answers with the WiFi down.
 */
export const ownBoxVisitFrom = (env: CommandEnv, target: string): string | null =>
  env.session.essid === null
    ? ownBoxSource({ target, ownIp: connectedWlan0(env.network)?.ipv4 ?? null })
    : null;

/**
 * Check a credential against the own box's `/etc/passwd` and record the attempt in the
 * door's own log, from the address the box was reached by. The tier the account carries,
 * or null for a refusal.
 *
 * An account with no password never matches, since no typed password hashes to empty:
 * the doors permit no empty password, so the player's own passwordless login is no way
 * in. The record is best-effort: the outcome stands whether or not the line lands.
 */
export const admitOwnBoxLogin = async (
  env: CommandEnv,
  attempt: {
    readonly door: OwnBoxDoor;
    readonly user: string;
    readonly password: string;
    readonly fromIp: string;
  },
): Promise<UserType | null> => {
  const account = accountIn(env.fs.root(), attempt.user);
  const admitted = account !== null && md5(attempt.password) === account.hash ? account : null;
  try {
    await env.log.appendAuthLog({
      kind: 'doorLogin',
      door: attempt.door,
      machineId: env.session.machineId,
      hostname: env.hostname,
      user: attempt.user,
      fromIp: attempt.fromIp,
      outcome: admitted === null ? 'failure' : 'success',
    });
  } catch {
    // best-effort: logging must never change whether the login happened.
  }
  return admitted?.userType ?? null;
};
