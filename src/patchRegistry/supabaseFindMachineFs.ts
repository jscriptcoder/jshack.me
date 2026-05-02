import { z } from 'zod';
import {
  filePermissionsSchema,
  type FilePermissions,
  type NodeType,
  type UserType,
} from './types.js';

// Adapter for L2's machine_filesystems lookup. Takes a (machine_id, path)
// pair and returns the projected node — owner, permissions, node_type —
// or signals "not found" / "lookup failed". L2 keys its walker decision
// on the returned permissions; the absence of a row falls back to allow
// today (the leaf-only enforcement gap documented in handler.ts and the
// Step 6 PR).
//
// The wiring layer (api/patches.ts) issues:
//
//   SELECT owner, permissions, node_type
//     FROM machine_filesystems
//    WHERE machine_id = $machine_id
//      AND path = $path
//    LIMIT 1;
//
// hitting the (machine_id, path) PK. Strict zod parse on the JSONB
// permissions field fails closed if the stored shape drifted (e.g.
// from a hand-written row or a legacy migration mismatch).

type RowError = { readonly code?: string; readonly message?: string } | null;

const nodeTypeSchema = z.enum(['file', 'directory']);
const userTypeSchema = z.enum(['root', 'user', 'guest']);

export type FindMachineFsParams = {
  readonly machine_id: string;
  readonly path: string;
};

export type MachineFsNode = {
  readonly owner: UserType;
  readonly permissions: FilePermissions;
  readonly node_type: NodeType;
};

export type FindMachineFsResult =
  | { readonly ok: true; readonly found: false }
  | { readonly ok: true; readonly found: true; readonly node: MachineFsNode }
  | { readonly ok: false };

export type FindMachineFsFn = (params: FindMachineFsParams) => Promise<{
  readonly data: ReadonlyArray<{
    readonly owner: unknown;
    readonly permissions: unknown;
    readonly node_type: unknown;
  }> | null;
  readonly error: RowError;
}>;

const machineFsRowSchema = z
  .object({
    owner: userTypeSchema,
    permissions: filePermissionsSchema,
    node_type: nodeTypeSchema,
  })
  .strict();

export const createSupabaseFindMachineFs =
  (query: FindMachineFsFn) =>
  async (params: FindMachineFsParams): Promise<FindMachineFsResult> => {
    const { data, error } = await query(params);
    if (error) return { ok: false };
    const row = data?.[0];
    if (!row) return { ok: true, found: false };
    const parsed = machineFsRowSchema.safeParse(row);
    if (!parsed.success) return { ok: false };
    return { ok: true, found: true, node: parsed.data };
  };
