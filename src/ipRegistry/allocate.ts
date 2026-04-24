import type { AllocateIpRequest, InsertResult, IpRow } from './types';

const MAX_ALLOCATION_ATTEMPTS = 10;

export type AllocateIpDeps = {
  readonly insertIp: (row: IpRow) => Promise<InsertResult>;
  readonly rollIp: () => string;
};

export type AllocateIpResult =
  | { readonly ok: true; readonly ip: string }
  | { readonly ok: false; readonly error: 'exhausted' | 'insert_failed' };

// Server-side allocator: rolls a candidate IP, attempts INSERT with PK
// collision = conflict → re-roll. Bounded retries. The PK on public_ips.ip is
// the hard uniqueness guarantee — this function just pairs a random roll with
// INSERT-or-retry until one wins.
export const allocateIp = async (
  request: AllocateIpRequest,
  deps: AllocateIpDeps,
): Promise<AllocateIpResult> => {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const ip = deps.rollIp();
    const row: IpRow = {
      ip,
      kind: request.kind,
      ...(request.owner_key !== undefined && { owner_key: request.owner_key }),
      ...(request.instance_ref !== undefined && { instance_ref: request.instance_ref }),
    };

    const outcome = await deps.insertIp(row);
    if (outcome === 'ok') return { ok: true, ip };
    if (outcome === 'error') return { ok: false, error: 'insert_failed' };
    // 'conflict' → retry
  }

  return { ok: false, error: 'exhausted' };
};
