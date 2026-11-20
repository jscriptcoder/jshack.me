/**
 * A box whose writes land, for the commands whose whole effect is the tree they leave.
 *
 * The command under test writes through the REAL `createPatchApi`, so the owner and
 * permissions it stamps on a write that names none are the adapter's, not a guess at
 * them. The fetch behind it keeps every row the adapter signs, and `box()` folds those
 * rows over the starting tree with the real `applyPatches` — the same replay the client
 * runs on the journal. A test then asks the tree what a player would see (`ls -l`,
 * `cat`), never which calls were made, so a command that sent the right call with the
 * wrong permissions, or the right permissions to the wrong path, cannot pass.
 */

import { z } from 'zod';
import { createPatchApi } from '../../adapters/patchApi.js';
import { applyPatches, type Patch } from '../../core/filesystem/applyPatches.js';
import { createFsView } from '../../core/filesystem/fsView.js';
import type { Directory } from '../../core/filesystem/types.js';
import { generateIdentity } from '../../core/identity/identity.js';
import { asAbsPath, asMachineId, type UserType } from '../../core/types.js';
import type { CommandEnv, FsView } from '../../core/commands/types.js';
import { mockCommandEnv, mockSession } from './commandEnv.js';

const tiers = z.array(z.enum(['root', 'user', 'guest']));

/** The fields of a signed patch request the replay needs. */
const patchRequest = z.object({
  action: z.string(),
  path: z.string(),
  content: z.string().nullable().optional(),
  owner: z.string(),
  permissions: z.object({ read: tiers, write: tiers, execute: tiers }).nullable().optional(),
  node_type: z.enum(['file', 'directory']).optional(),
  is_new: z.boolean().optional(),
});

const envelope = z.object({ payload: z.string() });

const toPatch = (request: z.infer<typeof patchRequest>): Patch => ({
  path: request.path,
  // A remove carries no content: it is the deletion marker.
  content: request.action === 'removePatch' ? null : (request.content ?? null),
  owner: request.owner,
  ...(request.permissions ? { permissions: request.permissions } : {}),
  ...(request.node_type ? { nodeType: request.node_type } : {}),
});

export type PatchedBox = {
  readonly env: CommandEnv;
  /** The machine as it stands after every write the command made. */
  readonly box: () => Directory;
  /** The same machine through the shell's own eyes, for `read`/`stat`/`list`. */
  readonly view: () => FsView;
  /** The paths whose row the command claimed as new — no base file stood there —
   *  which the tree cannot show but the journal keeps. */
  readonly claimedNew: () => readonly string[];
};

export const patchedBox = (options: {
  readonly tree: Directory;
  readonly userType: UserType;
  readonly username: string;
  readonly cwd: string;
  /** Paths whose every write the server refuses, as a dropped connection would. */
  readonly failingPaths?: readonly string[];
  /** Paths whose `mkdir` alone the server refuses. */
  readonly failingMkdirs?: readonly string[];
}): PatchedBox => {
  const patches: Patch[] = [];
  const newPaths = new Set<string>();
  const failing = new Set(options.failingPaths ?? []);
  const failingMkdirs = new Set(options.failingMkdirs ?? []);
  // `mkdir` and a directory's permission change sign the same row shape; only a
  // mkdir claims the path new.
  const isMkdir = (request: z.infer<typeof patchRequest>) =>
    request.node_type === 'directory' && request.is_new === true;

  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    const request = patchRequest.parse(JSON.parse(envelope.parse(JSON.parse(body)).payload));
    if (failing.has(request.path) || (isMkdir(request) && failingMkdirs.has(request.path))) {
      return new Response(null, { status: 500 });
    }
    if (request.is_new === true) newPaths.add(request.path);
    // The journal keeps one row per path and writer, replayed oldest first, and the
    // client re-pulls it after every write — so a second write to a path REPLACES the
    // first and moves to the end, and a remove clears the path's own rows beneath it
    // before leaving its tombstone. Appending instead would replay rows the server
    // never keeps: a `mkdir` the next row was meant to supersede.
    const within = (path: string) =>
      path === request.path ||
      (request.action === 'removePatch' && path.startsWith(`${request.path}/`));
    const kept = patches.filter((patch) => !within(patch.path));
    patches.splice(0, patches.length, ...kept, toPatch(request));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const cwd = asAbsPath(options.cwd);
  const box = (): Directory => applyPatches(options.tree, patches);
  const view = (): FsView => createFsView(box(), { userType: options.userType, cwd });

  const session = mockSession({ username: options.username, userType: options.userType });
  const patchApi = createPatchApi({
    identity: generateIdentity(),
    machineId: asMachineId('testbox-00000000'),
    owner: options.username,
    tier: options.userType,
    fetchImpl,
  });

  return {
    // The terminal builds a fresh env for every line it runs, over the tree as the
    // last line left it; so does this, each time a test reads it.
    get env() {
      return mockCommandEnv({ fs: view(), session, patches: patchApi });
    },
    box,
    view,
    claimedNew: () => [...newPaths].sort(),
  };
};
