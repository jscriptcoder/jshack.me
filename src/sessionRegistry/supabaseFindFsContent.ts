import { z } from 'zod';

// Generic adapter for reading any projected `machine_filesystems.content`
// entry by `(machine_id, path)`. Used by authCreateSession to fetch
// credential files server-side: /etc/passwd (PR 2), /etc/vsftpd/
// virtual_users.conf (PR 3), and the MySQL/Redis/SNMP credential files
// added in PR 4.
//
// The wiring layer (api/sessions.ts) issues:
//
//   SELECT content FROM machine_filesystems
//    WHERE machine_id = $machine_id AND path = $path LIMIT 1;
//
// Strict zod validation catches schema drift. On any error, falls
// closed → ok: false → handler maps to 500.
//
// PR 4 of plans/cross-player-base-fs-replication.md.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type FindFsContentParams = {
  readonly machine_id: string;
  readonly path: string;
};

export type FindFsContentResult =
  | { readonly ok: true; readonly found: false }
  | { readonly ok: true; readonly found: true; readonly content: string | null }
  | { readonly ok: false };

export type FindFsContentFn = (params: FindFsContentParams) => Promise<{
  readonly data: ReadonlyArray<{ readonly content: unknown }> | null;
  readonly error: RowError;
}>;

const rowSchema = z
  .object({
    content: z.string().nullable(),
  })
  .strict();

export const createSupabaseFindFsContent =
  (query: FindFsContentFn) =>
  async (params: FindFsContentParams): Promise<FindFsContentResult> => {
    const { data, error } = await query(params);
    if (error) return { ok: false };
    const row = data?.[0];
    if (!row) return { ok: true, found: false };
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return { ok: false };
    return { ok: true, found: true, content: parsed.data.content };
  };
