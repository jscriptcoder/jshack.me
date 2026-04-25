import { z } from 'zod';

// Every network type that holds a globally unique public IP. New kinds added
// here must also be added to the CHECK constraint in the public_ips migration.
export const IP_KINDS = [
  'mission_instance',
  'home_network',
  'pivot',
  'npc_faction',
  'darknet_hub',
] as const;

export type IpKind = (typeof IP_KINDS)[number];

// Internal allocator input — used between the handler and allocate.ts after
// the signed envelope has been verified and owner_key has been stamped from
// the verified pubkey. Not validated from external input directly.
export type AllocateIpRequest = {
  readonly kind: IpKind;
  readonly owner_key?: string;
  readonly instance_ref?: string;
};

// Schema for the signed payload that clients POST to /api/allocate-ip.
// Includes the signedRequest base fields (action/ts/nonce) plus the
// allocator-specific fields. owner_key is intentionally absent — the server
// derives it from the verified public key. Strict: rejects unknown fields.
export const allocateIpSignedPayloadSchema = z
  .object({
    action: z.literal('allocateIp'),
    ts: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{32}$/i),
    kind: z.enum(IP_KINDS),
    instance_ref: z.string().min(1).max(256).optional(),
  })
  .strict();

export type AllocateIpSignedPayload = z.infer<typeof allocateIpSignedPayloadSchema>;

// A single row in public_ips — used when the allocator hands an insert payload
// to the storage layer.
export type IpRow = {
  readonly ip: string;
  readonly kind: IpKind;
  readonly owner_key?: string;
  readonly instance_ref?: string;
};

// Result of attempting one INSERT. 'conflict' means PK collision (re-roll);
// 'error' means anything else (abort).
export type InsertResult = 'ok' | 'conflict' | 'error';
