/**
 * What a portforward job asks for: one machine behind the contract's router that the client wants
 * reached from outside, and the public port the router should send to it. The machine runs one
 * service, sealed, on its own port inside; the job is the forward, never a way through the
 * service. The machine names the box, so a contractor sweeping the LAN can tell it is the one
 * the briefing meant.
 *
 * Kept apart from the network's shape, which reads it to build the target, so the shape needs
 * nothing that reads the shape back.
 *
 * Nothing here is secret: like the rest of a contract's shape it ships in the bundle, and says
 * nothing about which contracts exist without the address.
 */

import { createPrng } from '../generation/prng.js';

/** The kinds of service a client wants reached. */
export type PortforwardService = 'mysql' | 'redis' | 'web' | 'ssh';

/** A machine a client wants a way into from outside. */
export type PortforwardMachine = {
  /** What the machine is, as the board and the briefing name it. */
  readonly noun: string;
  /** The suffix on the target's hostname, after the target company's stem. */
  readonly suffix: string;
  /** The service the client wants reached, which the machine runs. */
  readonly service: PortforwardService;
  /** The port the service answers on inside, which the forward must reach. */
  readonly insidePort: number;
  /** The public ports the client picks from: ones that read like the service they reach, and
   *  never one a contract router listens on or forwards. */
  readonly publicPorts: readonly number[];
  /** Why the client wants it reached, one of which opens the briefing. */
  readonly pitches: readonly string[];
  /** Why a client wants it shut off from outside again, on behalf of the customer whose machine
   *  it is: a white-hat job, one of which opens a close-the-door job's briefing. */
  readonly closeDoorPitches: readonly string[];
};

/** The machines a client may want reached from outside, or shut off from it again. */
export const EXPOSABLE_MACHINES: readonly PortforwardMachine[] = [
  {
    noun: 'customer database',
    suffix: 'db',
    service: 'mysql',
    insidePort: 3306,
    publicPorts: [13306],
    pitches: [
      'An auditor needs to look through their customer list without anyone knowing it was looked at.',
      'Our client wants their numbers live, not in a quarterly report.',
      'Every customer they sign lands in that database. We want to know the day it happens.',
    ],
    closeDoorPitches: [
      "Our customer's database answers from the internet, and nobody there opened it. They want it shut.",
      'Someone gave our customer a door from the outside straight into their customer records.',
      'Our customer found their database talking to strangers. They want it back behind the router.',
    ],
  },
  {
    noun: 'cache server',
    suffix: 'cache',
    service: 'redis',
    insidePort: 6379,
    publicPorts: [16379],
    pitches: [
      'Everything their site does passes through that cache first. We want to watch it pass.',
      'Their sessions sit in that cache. Our client wants to see who is signed in, and when.',
      'Our client wants to see their traffic as it happens, not after they have tidied it up.',
    ],
    closeDoorPitches: [
      "Our customer's cache answers anyone who knocks from outside, and their sessions pass through it.",
      'Someone opened our customer’s cache server to the internet. They want it shut before it is emptied.',
      'That cache should only ever talk to their own site. Right now it talks to anyone.',
    ],
  },
  {
    noun: 'staff intranet',
    suffix: 'intranet',
    service: 'web',
    insidePort: 80,
    publicPorts: [8080, 8443],
    pitches: [
      'Their staff read every announcement on that intranet before the rest of the world does.',
      'Our client wants to read their internal memos the morning they go up.',
      'Their org chart, their rotas and their plans all live on that intranet. We want to browse.',
    ],
    closeDoorPitches: [
      "Our customer's staff intranet can be read from anywhere. It was meant for their staff.",
      'Someone put our customer’s intranet on the internet, memos and all. They want it taken back off.',
      'Our customer found their internal pages answering from outside. They want that door shut.',
    ],
  },
  {
    noun: 'development server',
    suffix: 'dev',
    service: 'ssh',
    insidePort: 22,
    publicPorts: [2022, 8022],
    pitches: [
      'Their developers push to that box all day. Our client wants a door to it of our own.',
      'Our client has someone who can log in there, if only the box could be reached from outside.',
      'What they build next starts on that server. We want to be able to knock on it from home.',
    ],
    closeDoorPitches: [
      "Our customer's development server takes logins from outside, and nobody there set that up.",
      'Someone opened a way into our customer’s development server from the internet. They want it closed.',
      'Our customer’s developers found strangers knocking on their dev box from outside. They want it stopped.',
    ],
  },
];

/** What a portforward job asks for: the machine, and the public port that must reach it. */
export type PortforwardJob = {
  readonly machine: PortforwardMachine;
  readonly publicPort: number;
};

/** The machine a portforward job wants reached and the public port the client names, drawn on a
 *  stream of their own, the machine first, so nothing the contract drew before them moves. */
export const portforwardJob = (missionNumber: number): PortforwardJob => {
  const prng = createPrng(`mission-portforward-${missionNumber}`);
  const machine = prng.pick(EXPOSABLE_MACHINES);
  return { machine, publicPort: prng.pick(machine.publicPorts) };
};
