import { describe, expect, it } from 'vitest';
import { DRAWN_ROLES, machineRole, type MachineRole } from './machineRole';

/**
 * `machineRole` decides what a generated NPC box is FOR. It is derived rather than
 * stored — computed from the same coordinates the box's services and its backdoor
 * are, so two occupants scanning one machine agree about it without either of them
 * carrying the answer.
 *
 * A role is a property of the WORLD, not of any one box, so its distribution is only
 * observable across a population. The sample below mirrors the one every other
 * generation-time probability is measured over.
 */

const POPULATION_ESSIDS: readonly string[] = [
  'BEAN-THERE-WIFI',
  'SHINRA-5G',
  'ACME-CORP',
  'WEYLAND-NET',
  'CRACK-ME-WIFI',
  'HYDRA-CRACK-WIFI',
  'FETCH-LOG-WIFI',
  'TYRELL-NET',
];

const OCTETS = Array.from({ length: 253 }, (_, index) => index + 2); // 2..254

/** Every role the sample draws — 8 networks x 253 addresses. */
const population = (): readonly MachineRole[] =>
  POPULATION_ESSIDS.flatMap((essid) =>
    OCTETS.map((octet) => machineRole(essid, `192.168.29.${octet}`)),
  );

const countOf = (roles: readonly MachineRole[], role: MachineRole): number =>
  roles.filter((drawn) => drawn === role).length;

describe('machineRole', () => {
  it('gives the same box the same role however often it is asked', () => {
    // Two occupants scanning one machine must not disagree about what it is, and
    // neither must one occupant scanning it twice.
    const first = machineRole('BEAN-THERE-WIFI', '192.168.29.28');

    expect(machineRole('BEAN-THERE-WIFI', '192.168.29.28')).toBe(first);
  });

  it('gives two addresses on one network their own roles', () => {
    // A LAN of one repeated role is a list, not a population.
    const roles = OCTETS.map((octet) => machineRole('ACME-CORP', `192.168.29.${octet}`));

    expect(new Set(roles).size).toBeGreaterThan(1);
  });

  it('gives one address different roles on different networks', () => {
    // The role belongs to a box on a network, not to an address in the abstract —
    // otherwise every AP in the game would lay its boxes out identically.
    const roles = POPULATION_ESSIDS.map((essid) => machineRole(essid, '192.168.29.28'));

    expect(new Set(roles).size).toBeGreaterThan(1);
  });

  it('draws every role it knows about, so none is unreachable', () => {
    const roles = population();

    expect(DRAWN_ROLES.filter((role) => countOf(roles, role) === 0)).toEqual([]);
  });

  it('draws a home network, not a datacentre — personal kit is common and a database box is a find', () => {
    // The weights in rank order. A UNIFORM draw over seven roles puts ~289 of this
    // 2024-address sample in every bucket, so it cannot produce this ordering; nor
    // can a draw that ignores its arguments, which puts everything in one bucket.
    const roles = population();
    const ranked = [...DRAWN_ROLES].sort((left, right) => countOf(roles, right) - countOf(roles, left));

    expect(ranked).toEqual([
      'workstation',
      'iot',
      'webserver',
      'fileserver',
      'database',
      'mailserver',
      'dns',
    ]);
  });

  it('keeps the spread wide enough to be felt — a phone turns up many times per mailserver', () => {
    // Ordering alone survives a flattened weighting (32/26/16/12/7/4/3 collapsed
    // toward uniform keeps its order but stops meaning anything to a player). This
    // is the gap that makes a database box worth remarking on when you find one.
    const roles = population();

    expect(countOf(roles, 'workstation')).toBeGreaterThan(5 * countOf(roles, 'dns'));
    expect(countOf(roles, 'iot')).toBeGreaterThan(4 * countOf(roles, 'mailserver'));
  });
});
