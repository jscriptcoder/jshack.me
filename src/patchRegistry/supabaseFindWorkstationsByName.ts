import { z } from 'zod';

// Adapter for the cross-player base-FS endpoint. Given a parsed
// workstation_name (extracted from the requested machine_id by the
// handler), returns every matching workstations row.
//
// The handler decides which row matches by recomputing each row's
// expected workstation_id (`computeWorkstationId(name, player_key)`)
// and comparing against the requested machine_id. Two players choosing
// the same workstation_name produce different workstation_ids because
// the suffix is identity-derived; that's why we don't add a stored
// workstation_id column — same suffix-based dedupe that powers the
// rest of the model (workstation_id_model memory).
//
// The wiring layer (api/patches.ts) issues:
//
//   SELECT player_key, workstation_name, username, seed
//   FROM workstations WHERE workstation_name = $workstation_name;
//
// Strict zod validation catches schema drift. On any error, falls
// closed → ok: false → handler maps to 500 workstation_lookup_failed.

type RowError = { readonly code?: string; readonly message?: string } | null;

export type WorkstationRowWithSeed = {
  readonly player_key: string;
  readonly workstation_name: string;
  readonly username: string;
  readonly seed: string;
};

export type FindWorkstationsByNameParams = {
  readonly workstation_name: string;
};

export type FindWorkstationsByNameResult =
  | { readonly ok: true; readonly rows: ReadonlyArray<WorkstationRowWithSeed> }
  | { readonly ok: false };

export type FindWorkstationsByNameFn = (params: FindWorkstationsByNameParams) => Promise<{
  readonly data: ReadonlyArray<unknown> | null;
  readonly error: RowError;
}>;

const rowSchema = z
  .object({
    player_key: z.string(),
    workstation_name: z.string(),
    username: z.string(),
    seed: z.string(),
  })
  .strict();

export const createSupabaseFindWorkstationsByName =
  (query: FindWorkstationsByNameFn) =>
  async (params: FindWorkstationsByNameParams): Promise<FindWorkstationsByNameResult> => {
    let result;
    try {
      result = await query(params);
    } catch {
      return { ok: false };
    }
    const { data, error } = result;
    if (error) return { ok: false };
    if (!data) return { ok: true, rows: [] };

    const parsed: WorkstationRowWithSeed[] = [];
    for (const row of data) {
      const validation = rowSchema.safeParse(row);
      if (!validation.success) return { ok: false };
      parsed.push(validation.data);
    }
    return { ok: true, rows: parsed };
  };
