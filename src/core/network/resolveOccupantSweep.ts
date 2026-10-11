/**
 * handleResolveOccupantSweep — the server-side gate for a path sweep of a FELLOW
 * OCCUPANT's box, at the address it holds on the LAN the caller stands on.
 * `gobuster http://<a player's LAN address>` asks a neighbour's box about every word in
 * a list and reports which ones answer.
 *
 * It enters through the door a fetch of that box does (`resolveOccupantWebTarget`), so
 * the two can never disagree about which box an address reaches, whether it serves the
 * web on that port, or whether the caller stands where they may ask. Without it a
 * neighbour's pages could be fetched one at a time and never swept.
 *
 * Everything below the door is what makes a sweep different from a read, and is the
 * same as a sweep across networks (`handleResolveHttpSweep`). The list does not cross
 * the wire: it is read off the box the caller stands on, so a request cannot ask with
 * words the player never grew, and the same check that places the caller on that box is
 * what lets them use its list. Every request the run cost lands on the swept box as ONE
 * append, since the wall of 404s under a single stamp is the defender's tell. Sizes come
 * back, never pages: finding a path and reading it stay two acts.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import {
  resolveOccupantWebTarget,
  type HandlerResponse,
  type OccupantWebTargetDeps,
} from './resolveOccupantFetch.js';
import { recordSweep } from './resolveHttpSweep.js';
import { sweepWord } from './webSweep.js';
import { DIRLIST_PATH, parseDirlist } from './defaultDirlist.js';
import { wordlistOn } from '../wordlist/passwordSweep.js';
import type {
  MachineLogReadQuery,
  MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import type { ListPathPatchesResult, PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type ResolveOccupantSweepDeps = OccupantWebTargetDeps & {
  readonly nonceStore: NonceStore;
  /** The universe clock (UTC epoch-ms). ONE reading for the whole run. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Every writer's rows at the path list on the box the caller stands on — the file
   *  belongs to the box, not to whoever wrote it last. */
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey). No words
// field exists to send, and the box is always named: its list is the one asked with.
const resolveOccupantSweepSchema = z
  .looseObject({
    action: z.literal('resolveOccupantSweep'),
    essid: z.string().min(1),
    target: z.string().min(1),
    port: z.number().int(),
    caller_machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleResolveOccupantSweep = async (
  body: unknown,
  deps: ResolveOccupantSweepDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveOccupantSweepSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const target = await resolveOccupantWebTarget(
    deps,
    { publicKey, machineId: payload.caller_machine_id },
    payload,
  );
  if ('status' in target) return target;

  const dirlist = await deps.listPathPatches({
    machine_id: payload.caller_machine_id,
    path: DIRLIST_PATH,
  });
  if (dirlist.error) {
    return { status: 500, body: { error: 'dirlist_lookup_failed' } };
  }
  // A missing file is a real state, not an error, and is reported as such: an empty run
  // would read as a server with nothing on it rather than a tool with nothing to ask.
  const content = wordlistOn(dirlist.data);
  if (content === null) {
    return { status: 200, body: { ok: true, dirlistFound: false, results: [] } };
  }

  const swept = parseDirlist(content).map((word) => sweepWord(target.fs, word));

  await recordSweep(
    deps,
    target,
    target.sourceIp,
    swept.flatMap((word) => word.asked),
  );

  return {
    status: 200,
    body: {
      ok: true,
      dirlistFound: true,
      // One entry per WORD, in list order: a directory costs two requests and is still
      // one answer, reported as the address a player can go and fetch.
      results: swept.map((word) => word.found ?? word.asked[0]),
    },
  };
};
