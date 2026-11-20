import { describe, expect, it } from 'vitest';
import { chainJob, keyBoxSuffix } from './targetRoles.js';
import { chainFinal, missionKind, missionShape } from './missionShape.js';
import { missionTerms } from './missionTerms.js';
import { md5 } from '../generation/md5.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const CHAIN_NUMBERS = Array.from({ length: 6000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'chain');

/** The classic ports a client names for the listener it wants left. */
const CLASSIC_PORTS = [1337, 4444, 5555, 6666, 7777, 9001, 12345, 31337];

/** Every machine a client can want taken down. */
const MACHINES = [
  'CCTV recorder',
  'backup server',
  'monitoring station',
  'build server',
  'licence server',
  'door-access controller',
  'billing server',
];

describe('what a chain job names', () => {
  it("names a listener port from the backdoor job's eight, each about an eighth of the time", () => {
    const ports = CHAIN_NUMBERS.map((missionNumber) => chainJob(missionNumber).port);

    expect(new Set(ports)).toEqual(new Set(CLASSIC_PORTS));
    for (const port of CLASSIC_PORTS) {
      const share = ports.filter((drawn) => drawn === port).length / ports.length;
      expect(share, `port ${port}`).toBeGreaterThan(0.08);
      expect(share, `port ${port}`).toBeLessThan(0.17);
    }
  });

  it('names a machine to take down from the seven, each about a seventh of the time', () => {
    const machines = CHAIN_NUMBERS.map((missionNumber) => chainJob(missionNumber).role.noun);

    for (const machine of MACHINES) {
      const share = machines.filter((drawn) => drawn === machine).length / machines.length;
      expect(share, machine).toBeGreaterThan(0.1);
      expect(share, machine).toBeLessThan(0.19);
    }
  });

  // The machine to take down stands in the key-box slot, behind the front box the listener goes on.
  it('names the box in the key-box slot for the machine it asks taken down', () => {
    const takenDown = CHAIN_NUMBERS.filter((number) => chainFinal(number) === 'sabotage');

    expect(takenDown.length).toBeGreaterThan(0);
    for (const missionNumber of takenDown) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        chainJob(missionNumber).role.suffix,
      );
    }
  });

  // A file or the records sit on the company's file server, as on a destroy or wipe job.
  it('names the box in the key-box slot files when the last step destroys a file or wipes a table', () => {
    const onFiles = CHAIN_NUMBERS.filter((number) => chainFinal(number) !== 'sabotage');

    expect(onFiles.length).toBeGreaterThan(0);
    for (const missionNumber of onFiles) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe('files');
    }
  });

  it('asks a last step of taking the machine down, destroying a file or wiping a table, each about a third of the time', () => {
    const finals = CHAIN_NUMBERS.map(chainFinal);

    expect(new Set(finals)).toEqual(new Set(['sabotage', 'destroy', 'wipe']));
    for (const final of ['sabotage', 'destroy', 'wipe']) {
      const share = finals.filter((drawn) => drawn === final).length / finals.length;
      expect(share, final).toBeGreaterThan(0.28);
      expect(share, final).toBeLessThan(0.39);
    }
  });

  /** Chain jobs as they were before their last step was drawn: the listener's port, the pay, the
   *  client, and the digest of the front box with the gateway's forwards and admin, which the
   *  last step must never move. */
  const BEFORE_THE_LAST_STEP = [
    [110868, 1337, 4500, 'marlowe-ops', 'f41d91ef41c92f1f45b17258abdc20bb'],
    [213815, 4444, 6750, 'orchard-sec', '3fac3b7a9ff1503a909dd7e7c6c9c47f'],
    [261329, 12345, 6700, 'copper-ops', 'cfa023a1dfb0f6e955b7e565f305dbac'],
    [427628, 9001, 5450, 'wexley-desk', '2a8ffc4aa3fb1ade67b14b8ef0f313a1'],
    [657279, 12345, 6650, 'marlowe-ops', 'f2980404e02fb16fb2a9106f190a142a'],
    [704793, 5555, 5300, 'wexley-desk', '3d0d20a93d1c7ef0f5c0be5f95542c9b'],
    [720631, 1337, 4300, 'wexley-desk', '25e4001cf42e076b5d963ad9bd0036ee'],
    [1013634, 9001, 4550, 'copper-ops', '256096c252a7f42e2c221b7eeb3c0842'],
    [1029472, 9001, 5200, 'greyline-jobs', '2b74807946c67516397de98c525d7a24'],
    [1298718, 31337, 6300, 'redfern-contracts', 'b9ad2f262445e79100be2c135cb83844'],
    [1377908, 7777, 6100, 'orchard-sec', '1f46b60ae052691b3271fa23c286f8f6'],
    [1504612, 5555, 5800, 'ashgrove-it', 'a6d567ce2ef21ef2f233e57639b5487e'],
  ] as const;

  it('keeps every chain job its port, pay, client and front box, whichever last step it draws', () => {
    expect(new Set(BEFORE_THE_LAST_STEP.map(([number]) => chainFinal(number)))).toEqual(
      new Set(['sabotage', 'destroy', 'wipe']),
    );
    for (const [missionNumber, port, pay, handle, digest] of BEFORE_THE_LAST_STEP) {
      const shape = missionShape(missionNumber);
      const terms = missionTerms(missionNumber);
      const label = `contract ${missionNumber}, ${chainFinal(missionNumber)}`;

      expect(chainJob(missionNumber).port, label).toBe(port);
      expect(terms.pay, label).toBe(pay);
      expect(terms.client.handle, label).toBe(handle);
      expect(
        md5(
          JSON.stringify({
            frontBox: shape.frontBox,
            forwards: shape.forwards,
            gatewayAdminHash: shape.gatewayAdminHash,
          }),
        ),
        label,
      ).toBe(digest);
    }
  });
});
