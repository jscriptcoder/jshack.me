/**
 * orderPatchesForReplay — the chronological-combine rule for the shared patch
 * journal (Story 3, D1–D3).
 *
 * After the PK flip, ONE machine's rows can come from MULTIPLE writers (one row
 * per `(machine_id, path, writer_key)`). `applyPatches` folds left-to-right and
 * the last write for a path wins, so the reads must hand it rows pre-sorted into
 * chronological order: oldest first, latest last. Ordering uses the SERVER-
 * stamped `updated_at` (D2 — a client cannot forge its write earlier/later),
 * tiebroken deterministically by `writer_key` for the rare same-instant case.
 *
 * Sorting lives in `core/` (D3), not SQL, so the rule is unit + mutation tested
 * (`api/*` is not typechecked/tested locally). Pure: returns a fresh array; the
 * input is never mutated. `updated_at` is an ISO-8601 timestamptz string, so a
 * lexical compare is chronological (and preserves sub-millisecond precision).
 */

export type ReplayOrderable = {
  readonly updated_at: string;
  readonly writer_key: string;
};

/** Three-way lexical compare: -1 if `left` sorts first, 1 if `right` sorts
 *  first, 0 if equal. ISO-8601 timestamps and the writer key both order
 *  correctly under a lexical compare, so one helper drives both the
 *  chronological order and the tiebreak (a consistent comparator — `>` returns
 *  the symmetric verdict to `<`, never a dead branch). */
const lexicalCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const orderPatchesForReplay = <Row extends ReplayOrderable>(
  rows: readonly Row[],
): readonly Row[] =>
  [...rows].sort(
    (left, right) =>
      lexicalCompare(left.updated_at, right.updated_at) ||
      lexicalCompare(left.writer_key, right.writer_key),
  );
