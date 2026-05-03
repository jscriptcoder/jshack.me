import { z } from 'zod';
import { filePermissionsSchema, type FilePermissions, type UserType } from './types.js';

// Adapter for L2's machine_filesystems lookup. Takes a (machine_id, path)
// pair and returns the projected node — owner + permissions — or signals
// "not found" / "lookup failed". L2 keys its walker decision on the
// returned permissions; owner is unconsumed by L2 today but kept as a
// hedge for closing the chmod-via-forged-envelope gap (client's chmod
// uses userType === node.owner, server-side parity would need this
// field). The absence of a row falls back to allow today (the leaf-only
// enforcement gap documented in handler.ts).
//
// The wiring layer (api/patches.ts) issues:
//
//   SELECT owner, permissions
//     FROM machine_filesystems
//    WHERE machine_id = $machine_id
//      AND path = $path
//    LIMIT 1;
//
// hitting the (machine_id, path) PK. Strict zod parse on the JSONB
// permissions field fails closed if the stored shape drifted (e.g.
// from a hand-written row or a legacy migration mismatch).

type RowError = { readonly code?: string; readonly message?: string } | null;

const userTypeSchema = z.enum(['root', 'user', 'guest']);

export type FindMachineFsParams = {
  readonly machine_id: string;
  readonly path: string;
};

export type MachineFsNode = {
  readonly owner: UserType;
  readonly permissions: FilePermissions;
};

export type FindMachineFsResult =
  | { readonly ok: true; readonly found: false }
  | { readonly ok: true; readonly found: true; readonly node: MachineFsNode }
  | { readonly ok: false };

export type FindMachineFsFn = (params: FindMachineFsParams) => Promise<{
  readonly data: ReadonlyArray<{
    readonly owner: unknown;
    readonly permissions: unknown;
  }> | null;
  readonly error: RowError;
}>;

const machineFsRowSchema = z
  .object({
    owner: userTypeSchema,
    permissions: filePermissionsSchema,
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
