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

// Input schema for the allocation endpoint — strict, rejects unknown fields.
// owner_key is nullable for world-owned kinds (darknet_hub, npc_faction);
// instance_ref is nullable for kinds without a downstream instance row yet.
export const allocateIpRequestSchema = z
  .object({
    kind: z.enum(IP_KINDS),
    owner_key: z.string().min(1).max(256).optional(),
    instance_ref: z.string().min(1).max(256).optional(),
  })
  .strict();

export type AllocateIpRequest = z.infer<typeof allocateIpRequestSchema>;

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
