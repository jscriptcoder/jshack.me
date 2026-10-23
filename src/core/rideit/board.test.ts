import { describe, expect, it, vi } from 'vitest';
import { answerBoard, type BoardDeps } from './board.js';
import { TOWNS } from '../generation/world.js';
import type { PlayerLocationRow } from '../network/playerLocation.js';
import { sessionRow, sessionTable, type SessionRow } from '../../test/factories/sessionTable.js';

/**
 * Boarding a ride at rideit.io: a form POSTed to `/board` naming a town. A town the world
 * declares moves the player there; anything else is refused and changes nothing.
 *
 * Boarding is leaving, exactly as `nmcli disconnect` is: the player's box comes off every
 * network it is on, and every connection that ran through it closes, both ways. Only then
 * is the move written, so a write that fails leaves the player disconnected where they
 * were, never moved while still standing on a network in another town. The write names
 * the trip count it read and holds only if it still stands, so two boardings at once
 * count one trip.
 */

const PLAYER = 'alice-key';
const BOX = 'skylab-deadbeef';
const [FIRST_TOWN, SECOND_TOWN] = [TOWNS[0]!.name, TOWNS[1]!.name];

const boardFor = (town: string): string => new URLSearchParams({ town }).toString();

/** An in-memory `player_locations` table holding `initial` for the player, whose write
 *  holds only while the trip count it names is still the stored one. */
const locationStore = (initial: PlayerLocationRow | null) => {
  let row = initial;
  return {
    current: () => row,
    findPlayerLocation: vi.fn<BoardDeps['findPlayerLocation']>(async () => ({
      data: row,
      error: null,
    })),
    moveLocation: vi.fn<BoardDeps['moveLocation']>(async ({ town, tripsTaken }) => {
      if ((row?.trips ?? 0) !== tripsTaken) return { moved: false, error: null };
      row = { town, trips: tripsTaken + 1 };
      return { moved: true, error: null };
    }),
  };
};

/** A rideit wired to an in-memory location and `sessions` table, the player's box on one
 *  network unless `onNetworks` says otherwise. */
const makeDeps = (
  options: {
    readonly location?: PlayerLocationRow | null;
    readonly onNetworks?: number;
    readonly sessions?: readonly SessionRow[];
  } = {},
  over: Partial<BoardDeps> = {},
) => {
  const store = locationStore(options.location ?? null);
  const table = sessionTable(options.sessions ?? []);
  const deleteOccupancies = vi.fn<BoardDeps['deleteOccupancies']>(async () => ({
    data: Array.from({ length: options.onNetworks ?? 1 }, () => ({
      workstation_machine_id: BOX,
    })),
    error: null,
  }));
  const deps: BoardDeps = {
    findPlayerLocation: store.findPlayerLocation,
    moveLocation: store.moveLocation,
    deleteOccupancies,
    endVisitorSessions: table.endVisitorSessions,
    endOwnSessionsAway: table.endOwnSessionsAway,
    endSessionsAbove: table.endSessionsAbove,
    ...over,
  };
  return { deps, store, table, deleteOccupancies };
};

const board = (form: string, deps: BoardDeps) => answerBoard({ form, playerKey: PLAYER, deps });

const textOf = (page: string): string =>
  new DOMParser().parseFromString(page, 'text/html').body.textContent ?? '';

describe('answerBoard: where a ride goes', () => {
  it.each(TOWNS.map((town) => town.name))(
    'moves a player who never travelled to %s as their first trip, and says they arrived',
    async (town) => {
      const { deps, store } = makeDeps();

      const answer = await board(boardFor(town), deps);

      expect(answer?.left).toBe(true);
      expect(textOf(answer!.page)).toContain(`You have arrived in ${town}.`);
      expect(store.current()).toEqual({ town, trips: 1 });
    },
  );

  it('counts a traveller’s trip on from the ones they have taken', async () => {
    const { deps, store } = makeDeps({ location: { town: FIRST_TOWN, trips: 3 } });

    await board(boardFor(SECOND_TOWN), deps);

    expect(store.current()).toEqual({ town: SECOND_TOWN, trips: 4 });
    expect(store.moveLocation.mock.calls).toEqual([
      [{ ownerKey: PLAYER, town: SECOND_TOWN, tripsTaken: 3 }],
    ]);
  });

  it('takes a player to the town they already stand in as a trip like any other', async () => {
    const { deps, store, deleteOccupancies } = makeDeps({
      location: { town: FIRST_TOWN, trips: 1 },
    });

    const answer = await board(boardFor(FIRST_TOWN), deps);

    expect(answer?.left).toBe(true);
    expect(deleteOccupancies).toHaveBeenCalledTimes(1);
    expect(store.current()).toEqual({ town: FIRST_TOWN, trips: 2 });
  });

  it('reads where the player stands by the key it was given', async () => {
    const { deps, store } = makeDeps();

    await board(boardFor(FIRST_TOWN), deps);

    expect(store.findPlayerLocation.mock.calls).toEqual([[PLAYER]]);
  });

  it.each([
    ['a town the world does not declare', boardFor('Atlantis')],
    ['a town written in another case', boardFor(FIRST_TOWN.toLowerCase())],
    ['a town with space around it', boardFor(` ${FIRST_TOWN} `)],
    ['an empty town', boardFor('')],
    ['no town at all', 'destination=Millbrook'],
  ])('refuses %s, and changes nothing', async (_case, form) => {
    const { deps, store, deleteOccupancies } = makeDeps({
      location: { town: FIRST_TOWN, trips: 1 },
    });

    const answer = await board(form, deps);

    expect(answer?.left).toBe(false);
    expect(textOf(answer!.page)).toContain('We do not go there.');
    expect(deleteOccupancies).not.toHaveBeenCalled();
    expect(store.moveLocation).not.toHaveBeenCalled();
    expect(store.current()).toEqual({ town: FIRST_TOWN, trips: 1 });
  });
});

describe('answerBoard: boarding is leaving', () => {
  it('takes the player’s box off every network it is on, by the key it was given', async () => {
    const { deps, deleteOccupancies } = makeDeps();

    await board(boardFor(SECOND_TOWN), deps);

    expect(deleteOccupancies.mock.calls).toEqual([[PLAYER]]);
  });

  it('closes every connection through the box both ways, and keeps the owner’s own sessions on it', async () => {
    const { deps, table } = makeDeps({
      sessions: [
        sessionRow({ session_id: 'visitor', player_key: 'bob-key', machine_id: BOX }),
        sessionRow({ session_id: 'own-away', player_key: PLAYER, machine_id: 'darkstar-1' }),
        sessionRow({ session_id: 'own-home', player_key: PLAYER, machine_id: BOX }),
      ],
    });

    await board(boardFor(SECOND_TOWN), deps);

    expect(table.reasonOf('visitor')).toBe('network_left');
    expect(table.reasonOf('own-away')).toBe('network_left');
    expect(table.reasonOf('own-home')).toBeUndefined();
  });

  it('closes nothing when the store answers no rows at all', async () => {
    const { deps, store, table } = makeDeps(
      { sessions: [sessionRow({ session_id: 'own-home', player_key: PLAYER, machine_id: BOX })] },
      { deleteOccupancies: async () => ({ data: null, error: null }) },
    );

    const answer = await board(boardFor(SECOND_TOWN), deps);

    expect(answer?.left).toBe(true);
    expect(table.reasonOf('own-home')).toBeUndefined();
    expect(store.current()).toEqual({ town: SECOND_TOWN, trips: 1 });
  });

  it('still moves a player who was on no network, and still says they left', async () => {
    const { deps, store } = makeDeps({ onNetworks: 0 });

    const answer = await board(boardFor(SECOND_TOWN), deps);

    expect(answer?.left).toBe(true);
    expect(store.current()).toEqual({ town: SECOND_TOWN, trips: 1 });
  });
});

describe('answerBoard: two boardings at once', () => {
  it('stores one move and counts one trip; the other says the ticket was used, and still left', async () => {
    const { deps, store } = makeDeps({ location: { town: FIRST_TOWN, trips: 2 } });

    const answers = await Promise.all([
      board(boardFor(SECOND_TOWN), deps),
      board(boardFor(SECOND_TOWN), deps),
    ]);

    expect(store.current()).toEqual({ town: SECOND_TOWN, trips: 3 });
    expect(answers.map((answer) => answer?.left)).toEqual([true, true]);
    expect(answers.map((answer) => textOf(answer!.page))).toEqual([
      expect.stringContaining(`You have arrived in ${SECOND_TOWN}.`),
      expect.stringContaining('This ticket has already been used.'),
    ]);
  });
});

describe('answerBoard: a store that fails', () => {
  it('answers nothing, and leaves and moves nothing, when it cannot tell where the player stands', async () => {
    const { deps, deleteOccupancies, store } = makeDeps(
      {},
      { findPlayerLocation: async () => ({ data: null, error: new Error('down') }) },
    );

    expect(await board(boardFor(SECOND_TOWN), deps)).toBeNull();
    expect(deleteOccupancies).not.toHaveBeenCalled();
    expect(store.moveLocation).not.toHaveBeenCalled();
  });

  it('answers nothing, and moves nothing, when the box cannot be taken off its networks', async () => {
    const { deps, store } = makeDeps(
      {},
      { deleteOccupancies: async () => ({ data: null, error: new Error('down') }) },
    );

    expect(await board(boardFor(SECOND_TOWN), deps)).toBeNull();
    expect(store.moveLocation).not.toHaveBeenCalled();
  });

  it('answers nothing, and moves nothing, when a connection through the box cannot be closed', async () => {
    const { deps, store } = makeDeps(
      {},
      { endVisitorSessions: async () => ({ data: null, error: new Error('down') }) },
    );

    expect(await board(boardFor(SECOND_TOWN), deps)).toBeNull();
    expect(store.moveLocation).not.toHaveBeenCalled();
  });

  it('answers nothing when the move cannot be written', async () => {
    const { deps } = makeDeps(
      {},
      { moveLocation: async () => ({ moved: false, error: new Error('down') }) },
    );

    expect(await board(boardFor(SECOND_TOWN), deps)).toBeNull();
  });
});
