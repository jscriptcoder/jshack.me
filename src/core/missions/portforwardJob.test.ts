import { describe, expect, it } from 'vitest';
import { portforwardJob } from './portforwardJob.js';
import { keyBoxSuffix } from './targetRoles.js';
import { missionKind } from './missionShape.js';

/** A spread of portforward contract numbers whose last octet is a host octet (2–254). */
const PORTFORWARD_NUMBERS = Array.from({ length: 4000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'portforward');

/** Each machine a client wants a way into, what runs on it, and the public ports the client picks
 *  from: ones that read like the service they reach. */
const MACHINES = [
  ['customer database', 'db', 'mysql', 3306, [13306]],
  ['cache server', 'cache', 'redis', 6379, [16379]],
  ['staff intranet', 'intranet', 'web', 80, [8080, 8443]],
  ['development server', 'dev', 'ssh', 22, [2022, 8022]],
] as const;

describe('the machine a portforward job wants a way into', () => {
  it.each(MACHINES)(
    'is the %s, on <stem>-%s, its %s on %i, about a quarter of the time',
    (noun, suffix, service, insidePort) => {
      const jobs = PORTFORWARD_NUMBERS.map(portforwardJob);
      const drawn = jobs.filter(({ machine }) => machine.noun === noun);

      expect(drawn.length / jobs.length).toBeGreaterThan(0.18);
      expect(drawn.length / jobs.length).toBeLessThan(0.32);
      for (const { machine } of drawn) {
        expect(machine).toMatchObject({ suffix, service, insidePort });
      }
    },
  );

  it.each(MACHINES)(
    'asks for the %s on a public port of its own kind, each of them drawn',
    (noun, _suffix, _service, _insidePort, publicPorts) => {
      const drawn = PORTFORWARD_NUMBERS.map(portforwardJob).filter(
        ({ machine }) => machine.noun === noun,
      );

      expect(new Set(drawn.map(({ publicPort }) => publicPort))).toEqual(new Set(publicPorts));
    },
  );

  it('brings three pitches of its own for each machine, twelve in all', () => {
    const machines = new Map(
      PORTFORWARD_NUMBERS.map(portforwardJob).map(({ machine }) => [machine.noun, machine]),
    );
    const pitches = [...machines.values()].flatMap((machine) => machine.pitches);

    expect(machines.size).toBe(4);
    for (const machine of machines.values()) expect(machine.pitches).toHaveLength(3);
    expect(new Set(pitches).size).toBe(12);
    for (const pitch of pitches) expect(pitch).toMatch(/^[A-Z].{30,}\.$/);
  });

  it('names the target box after the machine', () => {
    for (const missionNumber of PORTFORWARD_NUMBERS) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        portforwardJob(missionNumber).machine.suffix,
      );
    }
  });
});
