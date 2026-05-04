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
export const registerWorkstationSignedPayloadSchema = z
  .object({
    action: z.literal('registerWorkstation'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    workstation_name: z.string().min(1).max(64),
    username: z.string().min(1).max(64),
  })
  .strict();

export type RegisterWorkstationPayload = z.infer<typeof registerWorkstationSignedPayloadSchema>;

// Internal allocator input — used between the handler and the
// supabaseUpsert adapter after the envelope has been verified and
// player_key has been stamped from the verified pubkey. Same shape as
// what populateBaseFs forwards into regenWorkstationRows.
export type WorkstationRow = {
  readonly player_key: string;
  readonly workstation_name: string;
  readonly username: string;
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
