import { z } from 'zod';

// Schema for the signed payload that clients POST to
// /api/register-workstation. Includes the signedRequest base fields
// (action/ts/nonce) plus the registration-specific fields. player_key
// is intentionally absent — the server stamps it from the verified
// pubkey. Strict: rejects unknown fields, mirroring sessions.
//
// Field bounds match the IntroScreen validation shape (workstation
// hostname max 24, username max 24) with a little headroom; the schema
// is the server-side contract — IntroScreen-side limits are UX, this
// is the boundary.
//
// seed and rootPassword drive correct /etc/passwd content projection.
// seed is persisted in the workstations row (used at request-time for
// regen of non-projected base FS in the cross-player chunk). rootPassword
// is consumed at register-time only — the server hashes it via
// generateLocalhost and embeds the hash in /etc/passwd content, then
// discards it. Never stored as a column; the threat-model implication
// (real MD5 hash on the server) is the same as already shipped via
// PR #122 — no new shift, just fixing the value being stored.
export const registerWorkstationSignedPayloadSchema = z
  .object({
    action: z.literal('registerWorkstation'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    workstation_name: z.string().min(1).max(64),
    username: z.string().min(1).max(64),
    seed: z.string().min(1).max(64),
    rootPassword: z.string().min(1).max(64),
  })
  .strict();

export type RegisterWorkstationPayload = z.infer<typeof registerWorkstationSignedPayloadSchema>;

// Internal allocator input — used between the handler and the
// supabaseUpsert adapter after the envelope has been verified and
// player_key has been stamped from the verified pubkey.
//
// `seed` is persisted (used at request-time for cross-player base-FS
// regen of non-projected paths). `rootPassword` is intentionally NOT
// on this row — it's transient, consumed at register-time by
// populateBaseFs to generate correct /etc/passwd content, then
// discarded. Keeping the persistence row free of rootPassword honors
// decision #2 in plans/cross-player-base-fs-replication.md (no separate
// root_password_hash column; the hash lives only inside projected
// /etc/passwd content).
export type WorkstationRow = {
  readonly player_key: string;
  readonly workstation_name: string;
  readonly username: string;
  readonly seed: string;
};

// Result of attempting one upsert. The discriminated success cases let
// the handler distinguish fresh-insert (populate base FS, 201) from
// idempotent-repeat (compare existing fields, 200 or 409). `existing`
// only carries the immutable fields the handler needs to compare —
// player_key is implied and created_at is operational.
export type UpsertWorkstationResult =
  | { readonly ok: true; readonly inserted: true }
  | {
      readonly ok: true;
      readonly inserted: false;
      readonly existing: {
        readonly workstation_name: string;
        readonly username: string;
      };
    }
  | { readonly ok: false };

// Result of attempting to bulk-populate machine_filesystems with the
// workstation's base FS. Best-effort from the handler's perspective —
// populate failure logs but doesn't block the 201 response (matches the
// home/world populate pattern; backfill script catches misses).
export type PopulateBaseFsResult = { readonly ok: boolean };
