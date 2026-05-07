// Allowlist of paths whose content gets dual-written into machine_filesystems.
//
// machine_filesystems exists to project owner + permissions for L2's
// permission walker. After 20260503210309_drop_machine_fs_unused_columns,
// it no longer carries content for the bulk of patched files (the patches
// table is the canonical content store, per-player). But a small set of
// paths need server-readable content for cross-player or server-authoritative
// concerns — /etc/passwd is the first such path (consumed by the server-side
// userType validation in createSession; see plans/etc-passwd-canonical.md
// step 5).
//
// Adding a new path here is a single-line change. The dual-write SQL function
// (upsert_patch_with_fs) checks the project_fs_content flag on every call
// and stores content only when the path is in this set.

export const FS_PROJECTED_CONTENT_PATHS: ReadonlySet<string> = new Set(['/etc/passwd']);

export const shouldProjectFsContent = (path: string): boolean =>
  FS_PROJECTED_CONTENT_PATHS.has(path);
