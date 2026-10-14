/**
 * A town's plan: its frame and name, its streets, and a numbered marker for each of its
 * places.
 *
 * Marker `n` stands for the `n`th place the town's page lists. Its streets and where each
 * marker stands are drawn on the town's own stream, so a town keeps its plan and no two
 * towns share one.
 */

import { createPrng, type Prng } from '../generation/prng.js';
import type { SizeClass, WorldTown } from '../generation/world.js';

/** As wide as the valley's drawing, so every page of the atlas lines up. */
const WIDTH = 78;

/** How many rows a town of each size is drawn on: the frame, the name and the town
 *  beneath it. A city's is room for a hundred places and more. */
const HEIGHTS: Readonly<Record<SizeClass, number>> = { village: 13, town: 19, city: 33 };

/** How many rows a plan grows by when its places do not fit: markers stand every other
 *  row, so two rows give a block one more row of them. */
const GROWTH = 2;

/** The row the town's name is written on, beneath the frame's top. */
const NAME_ROW = 1;

/** The fewest and the most streets a town of each size lays out: the long ones running
 *  across the plan, and the cross streets running down it. */
const STREETS: Readonly<
  Record<
    SizeClass,
    { readonly across: readonly [number, number]; readonly down: readonly [number, number] }
  >
> = {
  village: { across: [1, 1], down: [1, 2] },
  town: { across: [1, 2], down: [2, 3] },
  city: { across: [2, 3], down: [4, 5] },
};

/** The fewest rows from one street to the next, or to the name or the frame: room for one
 *  row of markers with a clear row on either side. */
const BLOCK_DEPTH = 4;

/** The fewest columns from one cross street to the next, or to the frame. */
const BLOCK_WIDTH = 8;

/**
 * Where `count` streets cross the span between two edges, each street at least `gap` from
 * the edges and from each other. The room left over is shared out at random, so the
 * blocks between them differ in size.
 */
const streetsBetween = (
  prng: Prng,
  edges: { readonly from: number; readonly to: number },
  count: number,
  gap: number,
): readonly number[] => {
  const spare = edges.to - edges.from - gap * (count + 1);
  const shares = Array.from({ length: count }, () => prng.nextInt(0, spare)).sort(
    (left, right) => left - right,
  );
  return shares.map((share, index) => edges.from + gap * (index + 1) + share);
};

/** 0, 1, 2 and so on, `count` of them. */
const indices = (count: number): readonly number[] => [...Array(count).keys()];

/** What a plan is drawn from: the town's stream, its size and its name. */
type PlannedTown = Pick<WorldTown, 'key' | 'name' | 'size'>;

/** A marker's place on the plan: its row, and the column its number starts in. */
type Spot = { readonly row: number; readonly column: number };

/** Every spot a marker `width` characters wide may take between consecutive edges: every
 *  other row and a column apart, a row and a column clear of every street, the name and the
 *  frame. */
const spotsBetween = (
  rowEdges: readonly number[],
  columnEdges: readonly number[],
  width: number,
): readonly Spot[] => {
  /** Where something `size` long may start between each two edges, `step` apart, a cell
   *  clear of both. A block is never too small to hold one: that is what `BLOCK_DEPTH` and
   *  `BLOCK_WIDTH` keep the streets apart for. */
  const within = (edges: readonly number[], step: number, size: number): readonly number[] =>
    edges.slice(1).flatMap((to, index) => {
      const first = (edges[index] ?? 0) + 2;
      const last = to - 1 - size;
      return indices(Math.floor((last - first) / step) + 1).map((place) => first + place * step);
    });
  return within(rowEdges, 2, 1).flatMap((row) =>
    within(columnEdges, width + 1, width).map((column) => ({ row, column })),
  );
};

/** The town's name, spaced out and centred inside the frame, each letter at the column it
 *  is drawn in. */
const titleOf = (town: PlannedTown): string => {
  const title = [...town.name.toUpperCase()].join(' ');
  return ' '.repeat(1 + Math.floor((WIDTH - 2 - title.length) / 2)) + title;
};

/** The plan of `town` on `height` rows with `placeCount` places marked on it, or nothing
 *  when its streets leave too few spots for them. */
const planOn = (
  town: PlannedTown,
  placeCount: number,
  height: number,
): readonly string[] | undefined => {
  const prng = createPrng(`town-plan-${town.key}`);
  const streets = STREETS[town.size];
  const across = streetsBetween(
    prng,
    { from: NAME_ROW, to: height - 1 },
    prng.nextInt(...streets.across),
    BLOCK_DEPTH,
  );
  const down = streetsBetween(
    prng,
    { from: 0, to: WIDTH - 1 },
    prng.nextInt(...streets.down),
    BLOCK_WIDTH,
  );
  const width = String(placeCount).length;
  const spots = spotsBetween([NAME_ROW, ...across, height - 1], [0, ...down, WIDTH - 1], width);
  if (spots.length < placeCount) return undefined;

  const cellAt = (row: number, column: number): string => {
    if (row === 0 || row === height - 1) return column === 0 || column === WIDTH - 1 ? '+' : '-';
    if (column === 0 || column === WIDTH - 1) return '|';
    if (row === NAME_ROW) return titleOf(town)[column] ?? ' ';
    const onStreetAcross = across.includes(row);
    const onStreetDown = down.includes(column);
    if (onStreetAcross && onStreetDown) return '+';
    if (onStreetAcross) return '-';
    return onStreetDown ? '|' : ' ';
  };
  const canvas = indices(height).map((row) => indices(WIDTH).map((column) => cellAt(row, column)));
  prng.pickN(spots, placeCount).forEach((spot, index) => {
    [...String(index + 1)].forEach((digit, offset) => {
      const line = canvas[spot.row];
      if (line !== undefined) line[spot.column + offset] = digit;
    });
  });
  return canvas.map((line) => line.join(''));
};

/** The plan of `town` with `placeCount` places marked on it, a line of it per entry: as tall
 *  as its size gives it, or taller by as few rows as its places need, so a place added to a
 *  town never falls off its plan. */
export const drawTownPlan = (town: PlannedTown, placeCount: number): readonly string[] => {
  const drawnFrom = (height: number): readonly string[] =>
    planOn(town, placeCount, height) ?? drawnFrom(height + GROWTH);
  return drawnFrom(HEIGHTS[town.size]);
};
