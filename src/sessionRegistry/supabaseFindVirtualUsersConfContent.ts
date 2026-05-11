import { z } from 'zod';

// Adapter for reading /etc/vsftpd/virtual_users.conf content from
// machine_filesystems for server-side FTP credential validation in
// authCreateSession (kind:'ftp').
//
// virtual_users.conf is the FTP overlay — when it lists a username,
// that hash takes precedence over /etc/passwd. When it doesn't (or
// when the file is absent), authCreateSession falls back to /etc/passwd.
// userType always derives from /etc/passwd; this file carries password
// hashes only (format `username:md5hash` per line).
//
// Mirrors createSupabaseFindEtcPasswdContent — same shape so the wiring
// in api/sessions.ts stays consistent. The MySQL/Redis/SNMP equivalents
// may generalize to a parameterized createSupabaseFindFsContent({ path }),
// but the per-file factory keeps this branch isolated.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type FindVirtualUsersConfContentParams = {
  readonly machine_id: string;
};

export type FindVirtualUsersConfContentResult =
  | { readonly ok: true; readonly found: false }
  | { readonly ok: true; readonly found: true; readonly content: string | null }
  | { readonly ok: false };

export type FindVirtualUsersConfContentFn = (params: FindVirtualUsersConfContentParams) => Promise<{
  readonly data: ReadonlyArray<{ readonly content: unknown }> | null;
  readonly error: RowError;
}>;

const rowSchema = z
  .object({
    content: z.string().nullable(),
  })
  .strict();

export const createSupabaseFindVirtualUsersConfContent =
  (query: FindVirtualUsersConfContentFn) =>
  async (params: FindVirtualUsersConfContentParams): Promise<FindVirtualUsersConfContentResult> => {
    const { data, error } = await query(params);
    if (error) return { ok: false };
    const row = data?.[0];
    if (!row) return { ok: true, found: false };
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return { ok: false };
    return { ok: true, found: true, content: parsed.data.content };
  };
