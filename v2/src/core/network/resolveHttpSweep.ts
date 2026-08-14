/**
 * handleResolveHttpSweep — the server-side gate for a CROSS-PLAYER path sweep.
 * `gobuster http://<public IP>` asks a stranger's box about every word in a list and
 * reports which ones answer. It is the recon a single fetch cannot do: `curl` confirms
 * what a page already told you, this asks about what nothing linked to.
 *
 * It enters through the same door a fetch does (`resolveWebTarget`), so the two can
 * never disagree about which box a public address and port reach, or whether it is
 * reachable at all. Everything below that is what makes a sweep different from a read.
 *
 * THE LIST DOES NOT CROSS THE WIRE. The caller names the machine they are standing on
 * and the server reads the path list off ITS journal, exactly as a credential sweep
 * reads the password list. Two things follow, and both are the point: a crafted request
 * cannot ask with words the player never grew, and pivoting onto somebody else's box
 * means sweeping with whatever list is on it — tools run where you stand, and so does
 * the ammunition. Naming a machine you neither own nor hold a session on is refused.
 *
 * ONE REQUEST, ONE APPEND. A word per round-trip would re-read and re-upsert the whole
 * log for every word and scatter the run across as many timestamps, when the wall of
 * 404s under a single stamp IS the defender's tell — the whole cost of using the tool.
 *
 * WHAT COMES BACK IS SIZES, NOT PAGES. Finding a path and reading it stay two acts, and
 * the second leaves its own line in the target's log. Returning the bodies here would
 * hand over every page found under the sweep's own wall, with nothing to say the
 * sweeper ever read them.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from '../patches/authorizeMachineAccess';
import { resolveWebTarget, type HandlerResponse, type WebTargetDeps } from './resolveHttpFetch';
import { sweepWord, type ProbedPath } from './webSweep';
import { DIRLIST_PATH, parseDirlist } from './defaultDirlist';
import { wordlistOn } from '../wordlist/passwordSweep';
import { HTTP_DEFAULT_PORT } from './http';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { ListPathPatchesResult, PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type ResolveHttpSweepDeps = WebTargetDeps & {
  readonly nonceStore: NonceStore;
  /** The universe clock (UTC epoch-ms). ONE reading for the whole run: the box handled
   *  one request, and stamping per line would spread a sweep across a span nothing
   *  observed. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** The attacker's own home public IP — the truthful origin of a sweep launched from
   *  their own workstation. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** One network's public IP from its ESSID — the origin of a sweep launched from a box
   *  the caller is standing on but does not own. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
  /** Whether the caller is really present on the machine they named. */
  readonly findActiveSession: FindActiveSession;
  /** Every writer's rows at the path list on that machine — the file belongs to the
   *  box, not to whoever wrote it last. */
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey). No words
// field exists to send — see the module doc.
const resolveHttpSweepSchema = z
  .looseObject({
    action: z.literal('resolveHttpSweep'),
    target: z.string().min(1),
    port: z.number().int().positive().optional(),
    caller_machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

/** Tell the box what it was just asked for — every probe, in the order tried, as ONE
 *  append. Best-effort: the sweep has already happened, and a logging failure must
 *  never surface to the requester, which would leak the defender's storage state to a
 *  stranger. Nothing asked, nothing said; nobody to key the log to, likewise. */
const recordSweep = async (
  deps: ResolveHttpSweepDeps,
  target: { readonly machineId: string; readonly logWriterKey: string | null },
  sourceIp: string,
  asked: readonly ProbedPath[],
): Promise<void> => {
  if (asked.length === 0 || target.logWriterKey === null) {
    return;
  }
  const time = asGameTime(deps.now());
  const lines = asked.map((probed) =>
    formatAccessLogLine({ time, sourceIp, path: probed.path, status: probed.status, size: probed.size }),
  );
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        // The log is the OWNER's, never the requester's — a stranger who could write
        // their own row would fork the file per visitor, and could then rewrite the
        // record of their own visit.
        writerKey: target.logWriterKey,
        machineId: target.machineId,
        path: ACCESS_LOG_PATH,
        owner: ACCESS_LOG_OWNER,
        permissions: ACCESS_LOG_PERMISSIONS,
      },
      lines.join('\n'),
    );
  } catch {
    // best-effort: the sweep's findings stand regardless of a logging failure.
  }
};

export const handleResolveHttpSweep = async (
  body: unknown,
  deps: ResolveHttpSweepDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveHttpSweepSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Before anything is read or asked: the list about to be used belongs to this box,
  // and a caller who is not on it may not sweep with it.
  const access = await authorizeMachineAccess(
    publicKey,
    payload.caller_machine_id,
    deps.findActiveSession,
  );
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  const target = await resolveWebTarget(deps, {
    target: payload.target,
    port: payload.port ?? HTTP_DEFAULT_PORT,
  });
  if ('status' in target) {
    return target;
  }

  const dirlist = await deps.listPathPatches({
    machine_id: payload.caller_machine_id,
    path: DIRLIST_PATH,
  });
  if (dirlist.error) {
    return { status: 500, body: { error: 'dirlist_lookup_failed' } };
  }
  // A missing file is a real state, not an error: the list is an ordinary file the
  // player installs and curates. Reported as such, because an empty run would read as
  // a server with nothing on it rather than a tool with nothing to ask.
  const content = wordlistOn(dirlist.data);
  if (content === null) {
    return { status: 200, body: { ok: true, dirlistFound: false, results: [] } };
  }

  const swept = parseDirlist(content).map((word) => sweepWord(target.fs, word));

  await recordSweep(
    deps,
    target,
    await resolveVantageSourceIp(deps, {
      actorKey: publicKey,
      standingEssid: access.session === null ? null : access.session.essid,
    }),
    swept.flatMap((word) => word.asked),
  );

  return {
    status: 200,
    body: {
      ok: true,
      dirlistFound: true,
      // One entry per WORD, in list order — a directory costs two requests and is still
      // one answer. What is reported is the address a player can go and fetch.
      results: swept.map((word) => word.found ?? word.asked[0]),
    },
  };
};
