/**
 * patchApi adapter — the real `PatchApi` (write/remove/mkdir) plus the
 * own-workstation read (`fetchOwnPatches`), both speaking the signed
 * `/api/patches` envelope.
 *
 * This is the seam between the framework-agnostic command layer and the
 * server. Commands see only `env.patches` (the `PatchApi`); the UI uses
 * `fetchOwnPatches` to hydrate the patch journal on boot and after each write.
 *
 * Signing (hex private key → bytes → Ed25519) is encapsulated by
 * `signRequest`, so this file only assembles action fields and maps the HTTP
 * result back to the discriminated `PatchResult` the command contract expects.
 *
 * `fetchImpl` is injected so tests can drive the wire shape without a network.
 */

import { signRequest } from '../core/signedRequest/sign';
import { contentHash } from '../core/patches/contentHash';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../core/filesystem/defaultPermissions';
import type { Patch } from '../core/filesystem/applyPatches';
import type { TransferDirection } from '../core/logging/vsftpdLog';
import type { FilePermissions } from '../core/filesystem/types';
import type {
  AccessLogFetch,
  AuthLogEvent,
  DeepScanRecordParams,
  Identity,
  PatchApi,
  PatchResult,
  ScanRecordParams,
} from '../core/commands/types';
import type { AbsPath, MachineId, UserType } from '../core/types';

const DEFAULT_ENDPOINT = '/api/patches';

export type PatchClientDeps = {
  readonly identity: Identity;
  /** The machine these patches target — the player's own workstation id. */
  readonly machineId: MachineId;
  /** Owner stamped on new nodes (the session username). */
  readonly owner: string;
  /** Tier used to derive default permissions for new nodes. */
  readonly tier: UserType;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
};

type ServerPatchRow = {
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions?: FilePermissions | null;
  readonly node_type?: 'file' | 'directory';
};

const post = async (
  deps: PatchClientDeps,
  action: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<Response> => {
  const doFetch = deps.fetchImpl ?? fetch;
  const envelope = signRequest(deps.identity, action, fields);
  return doFetch(deps.endpoint ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
};

/** Map an upsert response to the command contract's PatchResult. 403 is the
 *  own-workstation/L1 rejection (no_session); 409 is the refusal to overwrite
 *  content the writer was not shown; anything else non-ok is treated as a
 *  transport-level failure. */
const toPatchResult = (response: Response): PatchResult => {
  if (response.ok) return { ok: true };
  if (response.status === 403) return { ok: false, error: 'no_session' };
  if (response.status === 409) return { ok: false, error: 'modified_since_open' };
  return { ok: false, error: 'network_error' };
};

const upsert = async (
  deps: PatchClientDeps,
  fields: Readonly<Record<string, unknown>>,
): Promise<PatchResult> => {
  try {
    return toPatchResult(await post(deps, 'upsertPatch', fields));
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

export const createPatchApi = (deps: PatchClientDeps): PatchApi => ({
  // `is_new` is stamped ONLY for a genuinely-new file; an overwrite omits it so
  // the server's upsert preserves whatever `is_new` the row already carries
  // (a base file stays `false`, a player-created file stays `true`).
  write: (
    path: AbsPath,
    content: string,
    options?: {
      readonly isNew?: boolean;
      readonly permissions?: FilePermissions;
      readonly baseContent?: string;
    },
  ) =>
    upsert(deps, {
      machine_id: deps.machineId,
      path,
      content,
      owner: deps.owner,
      permissions: options?.permissions ?? defaultFilePermissions(deps.tier),
      node_type: 'file',
      ...(options?.isNew ? { is_new: true } : {}),
      // Only a caller that was shown the file names a base; the fingerprint (not
      // the content) travels, and its ABSENCE is what keeps every other write path
      // unconditional.
      ...(options?.baseContent === undefined
        ? {}
        : { base_hash: contentHash(options.baseContent) }),
    }),

  // Deletion is server-authoritative (delete-row vs tombstone decided from the
  // patches table); the client only names the path to remove.
  remove: async (path: AbsPath): Promise<PatchResult> => {
    try {
      return toPatchResult(
        await post(deps, 'removePatch', {
          machine_id: deps.machineId,
          path,
          owner: deps.owner,
        }),
      );
    } catch {
      return { ok: false, error: 'network_error' };
    }
  },

  mkdir: (path: AbsPath) =>
    upsert(deps, {
      machine_id: deps.machineId,
      path,
      content: null,
      owner: deps.owner,
      permissions: defaultDirectoryPermissions(deps.tier),
      is_new: true,
      node_type: 'directory',
    }),
});

/** Record an `su` user-switch to the caller's own `/var/log/auth.log`. Sends
 *  only the EVENT — the server stamps the UTC timestamp and formats the line, so
 *  the client never dictates game time. Returns the same `PatchResult` the UI
 *  uses to decide whether to reconcile the local journal (refetch). */
export const postAuthLog = async (
  deps: PatchClientDeps,
  event: AuthLogEvent,
): Promise<PatchResult> => {
  try {
    return toPatchResult(
      await post(deps, 'appendAuthLog', {
        machine_id: event.machineId,
        target_user: event.targetUser,
        from_user: event.fromUser,
        outcome: event.outcome,
        hostname: event.hostname,
      }),
    );
  } catch {
    return { ok: false, error: 'network_error' };
  }
};

/** Fire the server-internal own-LAN fetch log: the server resolves WHICH box answered
 *  from the (verified pubkey, essid, target) — the caller's own workstation or a
 *  generated sibling — reads the page itself, and writes that box's
 *  `/var/log/access.log`. The client only names what it fetched. Best-effort +
 *  fire-and-forget, like `recordScan`: a failure resolves silently so logging never
 *  breaks (or delays) the fetch. */
export const recordLanFetch = async (
  deps: PatchClientDeps,
  fetched: AccessLogFetch,
): Promise<void> => {
  try {
    await post(deps, 'recordLanFetch', {
      essid: fetched.essid,
      target: fetched.target,
      port: fetched.port,
      paths: fetched.paths,
      source_ip: fetched.sourceIp,
    });
  } catch {
    // best-effort: a logging failure must not surface to the fetch.
  }
};

/** What one ftp transfer tells the box it crossed: which machine, which way, which
 *  file, how many bytes, and the address at the other end. The ACCOUNT is deliberately
 *  absent — the server reads that off the session row, so the log names who the player
 *  really logged in as rather than who they say they are. */
export type FtpTransferRecord = {
  readonly machineId: MachineId;
  readonly direction: TransferDirection;
  readonly path: AbsPath;
  readonly bytes: number;
  readonly sourceIp: string | null;
  /** The box the transfer was run FROM. On a generated host it changes nothing — the
   *  reported address is already the only one that box could have seen. On another
   *  player's box it is what lets the server name the network the visitor is standing
   *  on, rather than the one they own. */
  readonly callerMachineId: MachineId;
};

/** Fire the remote box's own transfer log: the server checks the caller holds a
 *  session there, then appends the `OK DOWNLOAD`/`OK UPLOAD` line to its
 *  `/var/log/vsftpd.log`. Best-effort + fire-and-forget like the other traces — the
 *  bytes have already moved, so a logging failure must not surface as a failed
 *  transfer. */
export const recordFtpTransfer = async (
  deps: PatchClientDeps,
  transfer: FtpTransferRecord,
): Promise<void> => {
  try {
    await post(deps, 'recordFtpTransfer', {
      machine_id: transfer.machineId,
      direction: transfer.direction,
      path: transfer.path,
      bytes: transfer.bytes,
      source_ip: transfer.sourceIp,
      caller_machine_id: transfer.callerMachineId,
    });
  } catch {
    // best-effort: a logging failure must not surface to the transfer.
  }
};

/** Fire the server-internal scan log: the server resolves the scanned hosts from
 *  the (verified pubkey, essid, target) and writes each one's `/var/log/kern.log`
 *  itself — the client only names what it scanned. Best-effort + fire-and-forget:
 *  a failure resolves silently so logging never breaks (or delays) the scan. */
export const recordScan = async (
  deps: PatchClientDeps,
  params: ScanRecordParams,
): Promise<void> => {
  try {
    await post(deps, 'nmapScan', {
      essid: params.essid,
      target: params.target,
      source_ip: params.sourceIp,
    });
  } catch {
    // best-effort: a logging failure must not surface to the scan.
  }
};

/** Fire the server-internal DEEP scan log: the deep hosts resolve client-side, but
 *  the server re-derives the vantage from the (verified pubkey, essid,
 *  vantage_machine_id), regenerates its deep layer, and writes each touched deep
 *  host's `/var/log/kern.log` itself. Best-effort + fire-and-forget, like
 *  `recordScan`. */
export const recordDeepScan = async (
  deps: PatchClientDeps,
  params: DeepScanRecordParams,
): Promise<void> => {
  try {
    await post(deps, 'nmapScanDeep', {
      essid: params.essid,
      target: params.target,
      vantage_machine_id: params.vantageMachineId,
    });
  } catch {
    // best-effort: a logging failure must not surface to the scan.
  }
};

const rowToPatch = (row: ServerPatchRow): Patch => ({
  path: row.path,
  content: row.content,
  owner: row.owner,
  ...(row.permissions ? { permissions: row.permissions } : {}),
  ...(row.node_type ? { nodeType: row.node_type } : {}),
});

/** Read the caller's own-workstation patch journal. Returns `[]` on any
 *  failure so boot/refetch degrades to the base FS rather than crashing the
 *  terminal. */
export const fetchOwnPatches = async (deps: PatchClientDeps): Promise<readonly Patch[]> => {
  try {
    const response = await post(deps, 'listPatches', { machine_id: deps.machineId });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const rows = (body as { patches?: readonly ServerPatchRow[] } | null)?.patches ?? [];
    return rows.map(rowToPatch);
  } catch {
    return [];
  }
};
