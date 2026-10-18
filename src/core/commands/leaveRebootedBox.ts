/**
 * Stepping off a box that has just gone down. Shared by the acts that take one down from
 * a shell standing on it — `reboot`, and `apt` flashing a router's firmware — and by the
 * shell itself, which tells a player whose box went down under them on their next line.
 */

import type { CommandEnv } from './types.js';

/** What a shell says when the box it was standing on went down underneath it — the line
 *  the real thing prints when the far end stops answering mid-session. */
export const connectionClosedLine = (hostname: string): string =>
  `Connection to ${hostname} closed by remote host.`;

/** Disconnect the player from the machine just rebooted: pop every session that sits on
 *  it (the box went down), counting from the top of the hop chain but NEVER the base
 *  login (the player's own box is always reachable). On the own base box there is
 *  nothing above the base, so nothing is popped. */
export const leaveRebootedBox = (
  env: Pick<CommandEnv, 'session' | 'hopChain' | 'popSession'>,
): void => {
  const rebooted = env.session.machineId;
  // The stack from the top (active) down, minus the base login at the bottom.
  const aboveBase = [env.session, ...[...env.hopChain].reverse()].slice(0, -1);
  let pops = 0;
  for (const session of aboveBase) {
    if (session.machineId !== rebooted) break;
    pops += 1;
  }
  for (let popped = 0; popped < pops; popped += 1) env.popSession();
};
