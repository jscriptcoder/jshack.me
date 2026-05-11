import { z } from 'zod';

// Batch fetch of machine_filesystems content for a list of paths on a
// single machine. Used by the cross-player base-FS endpoint to retrieve
// the projected auth-critical content (/etc/passwd, vsftpd, mysql,
// redis, snmp, nc pidfiles) in one round-trip and overlay it onto the
// regenerated FS.
//
// The wiring layer (api/patches.ts) issues:
//
//   SELECT path, content FROM machine_filesystems
//    WHERE machine_id = $machine_id
//      AND path IN ($paths)
//      AND content IS NOT NULL;
//
// The IS NOT NULL filter drops rows that exist for L2 enforcement
// (owner + permissions) but aren't projected — only projected paths
// have content per the FS_PROJECTED_CONTENT_PATHS allowlist.
//
// Empty paths short-circuits without hitting the DB. Strict zod parse
// catches schema drift; any malformed row collapses to ok:false → the
// handler maps to 500 fs_lookup_failed.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type FindFsContentBatchParams = {
  readonly machine_id: string;
  readonly paths: ReadonlyArray<string>;
};

export type FindFsContentBatchResult =
  | { readonly ok: true; readonly contentByPath: ReadonlyMap<string, string> }
  | { readonly ok: false };

export type FindFsContentBatchFn = (params: FindFsContentBatchParams) => Promise<{
  readonly data: ReadonlyArray<unknown> | null;
  readonly error: RowError;
}>;

const rowSchema = z
  .object({
    path: z.string().min(1),
    content: z.string().nullable(),
  })
  .strict();

export const createSupabaseFindFsContentBatch =
  (query: FindFsContentBatchFn) =>
  async (params: FindFsContentBatchParams): Promise<FindFsContentBatchResult> => {
    if (params.paths.length === 0) return { ok: true, contentByPath: new Map() };

    let result;
    try {
      result = await query(params);
    } catch {
      return { ok: false };
    }
    const { data, error } = result;
    if (error) return { ok: false };
    if (!data) return { ok: true, contentByPath: new Map() };

    const contentByPath = new Map<string, string>();
    for (const row of data) {
      const parsed = rowSchema.safeParse(row);
      if (!parsed.success) return { ok: false };
      // Drop null content entries — only paths whose content is actually
      // projected contribute to the overlay.
      if (parsed.data.content !== null) {
        contentByPath.set(parsed.data.path, parsed.data.content);
      }
    }
    return { ok: true, contentByPath };
  };
