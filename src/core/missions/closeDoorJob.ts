/**
 * What a close-the-door job asks for: one machine behind the customer's router that someone made
 * reachable from outside, and the public port they forwarded to it. The machines are the
 * portforward job's own, read from its table, so a customer database looks and answers the same
 * whether a client wants a way into it or wants one shut.
 *
 * Nothing here is secret: like the rest of a contract's shape it ships in the bundle, and says
 * nothing about which contracts exist without the address.
 */

import { createPrng } from '../generation/prng.js';
import { EXPOSABLE_MACHINES, type PortforwardMachine } from './portforwardJob.js';

/** What a close-the-door job asks for: the machine exposed, and the public port that reaches it. */
export type CloseDoorJob = {
  readonly machine: PortforwardMachine;
  readonly publicPort: number;
};

/** The machine a close-the-door job's client wants shut off from outside and the public port the
 *  forward to it uses, drawn on a stream of their own, the machine first. */
export const closeDoorJob = (missionNumber: number): CloseDoorJob => {
  const prng = createPrng(`mission-closedoor-${missionNumber}`);
  const machine = prng.pick(EXPOSABLE_MACHINES);
  return { machine, publicPort: prng.pick(machine.publicPorts) };
};
