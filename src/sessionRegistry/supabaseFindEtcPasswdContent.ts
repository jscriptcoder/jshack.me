import { z } from 'zod';

// Adapter for reading /etc/passwd content from machine_filesystems for
// server-side userType validation in createSession.
//
// /etc/passwd's content is dual-written into machine_filesystems for
// machines that the player has interacted with (home/world/workstations
// — see populate*BaseFs scripts and the upsert_patch_with_fs SQL function
// with p_project_fs_content=true). Mission machines don't appear in
// machine_filesystems at all today (blocked on mission_instances), so
// found=false signals "no projection available — no-op validation".
//
// The wiring layer (api/sessions.ts) issues:
//
//   SELECT content FROM machine_filesystems
//    WHERE machine_id = $machine_id AND path = '/etc/passwd' LIMIT 1;
//
// Strict zod validation catches schema drift (e.g. a future migration
// changing the content column type). On any error, falls closed →
// ok: false → handler maps to 500.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type FindEtcPasswdContentParams = {
  readonly machine_id: string;
};

export type FindEtcPasswdContentResult =
  | { readonly ok: true; readonly found: false }
  | { readonly ok: true; readonly found: true; readonly content: string | null }
  | { readonly ok: false };

export type FindEtcPasswdContentFn = (params: FindEtcPasswdContentParams) => Promise<{
  readonly data: ReadonlyArray<{ readonly content: unknown }> | null;
  readonly error: RowError;
}>;

const rowSchema = z
  .object({
    content: z.string().nullable(),
  })
  .strict();

export const createSupabaseFindEtcPasswdContent =
  (query: FindEtcPasswdContentFn) =>
  async (params: FindEtcPasswdContentParams): Promise<FindEtcPasswdContentResult> => {
    const { data, error } = await query(params);
    if (error) return { ok: false };
    const row = data?.[0];
    if (!row) return { ok: true, found: false };
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return { ok: false };
    return { ok: true, found: true, content: parsed.data.content };
  };
