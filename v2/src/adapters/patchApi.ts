/**
 * patchApi adapter — the real `PatchApi` (write/remove/mkdir) plus the
 * own-workstation read (`fetchOwnPatches`), both speaking the signed
 * `/api/patches` envelope.
 *
 * This is the seam between the framework-agnostic command layer and the
 * server. Commands see only `env.patches` (the `PatchApi`); the UI uses
 * `fetchOwnPatches` to hydrate the patch journal on boot and after each write.
 *
 * Signing (hex private key → bytes → Ed25519) is encapsulated by
 * `signRequest`, so this file only assembles action fields and maps the HTTP
 * result back to the discriminated `PatchResult` the command contract expects.
 *
 * `fetchImpl` is injected so tests can drive the wire shape without a network.
 */

import { signRequest } from '../core/signedRequest/sign';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../core/filesystem/defaultPermissions';
import type { Patch } from '../core/filesystem/applyPatches';
import type { FilePermissions } from '../core/filesystem/types';
import type { Identity, PatchApi, PatchResult } from '../core/commands/types';
import type { AbsPath, MachineId, UserType } from '../core/types';

const DEFAULT_ENDPOINT = '/api/patches';

export type PatchClientDeps = {
  readonly identity: Identity;
  /** The machine these patches target — the player's own workstation id. */
  readonly machineId: MachineId;
  /** Owner stamped on new nodes (the session username). */
  readonly owner: string;
  /** Tier used to derive default permissions for new nodes. */
  readonly tier: UserType;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
};

type ServerPatchRow = {
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions?: FilePermissions | null;
  readonly node_type?: 'file' | 'directory';
};

const post = async (
  deps: PatchClientDeps,
  action: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<Response> => {
  const doFetch = deps.fetchImpl ?? fetch;
  const envelope = signRequest(deps.identity, action, fields);
  return doFetch(deps.endpoint ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
};

/** Map an upsert response to the command contract's PatchResult. 403 is the
 *  own-workstation/L1 rejection (no_session); anything else non-ok is treated
 *  as a transport-level failure. */
const toPatchResult = (response: Response): PatchResult => {
  if (response.ok) return { ok: true };
  if (response.status === 403) return { ok: false, error: 'no_session' };
  return { ok: false, error: 'network_error' };
};

const upsert = async (
  deps: PatchClientDeps,
  fields: Readonly<Record<string, unknown>>,
): Promise<PatchResult> => {
  try {
    return toPatchResult(await post(deps, 'upsertPatch', fields));
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

export const createPatchApi = (deps: PatchClientDeps): PatchApi => ({
  write: (path: AbsPath, content: string) =>
    upsert(deps, {
      machine_id: deps.machineId,
      path,
      content,
      owner: deps.owner,
      permissions: defaultFilePermissions(deps.tier),
      node_type: 'file',
    }),

  remove: (path: AbsPath) =>
    upsert(deps, { machine_id: deps.machineId, path, content: null, owner: deps.owner }),

  mkdir: (path: AbsPath) =>
    upsert(deps, {
      machine_id: deps.machineId,
      path,
      content: null,
      owner: deps.owner,
      permissions: defaultDirectoryPermissions(deps.tier),
      is_new: true,
      node_type: 'directory',
    }),
});

const rowToPatch = (row: ServerPatchRow): Patch => ({
  path: row.path,
  content: row.content,
  owner: row.owner,
  ...(row.permissions ? { permissions: row.permissions } : {}),
  ...(row.node_type ? { nodeType: row.node_type } : {}),
});

/** Read the caller's own-workstation patch journal. Returns `[]` on any
 *  failure so boot/refetch degrades to the base FS rather than crashing the
 *  terminal. */
export const fetchOwnPatches = async (deps: PatchClientDeps): Promise<readonly Patch[]> => {
  try {
    const response = await post(deps, 'listPatches', { machine_id: deps.machineId });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const rows = (body as { patches?: readonly ServerPatchRow[] } | null)?.patches ?? [];
    return rows.map(rowToPatch);
  } catch {
    return [];
  }
};
