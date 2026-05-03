import type { FilePermissions, PermissionResult } from './types';
import type { UserType } from '../session/SessionContext';

// Shared L2-compatible permission decision. Pure function — same module
// imported by both the client (FileSystemContext) and the server
// (L2 patch validation handler), so the two sides always agree on
// allow/deny for a given (userType, mode, target, parentChain).
//
// Inputs:
//   userType    — the requester's effective user (root | user | guest).
//   mode        — which list to check on the target (read | write | execute).
//   target      — the target node's permission allowlist.
//   parentChain — every ancestor's permission allowlist, ordered
//                 root-to-immediate-parent. Each parent must contain
//                 the requester in its execute list. An empty chain
//                 means the target is at the filesystem root.
//
// Returns:
//   { allowed: true } if the requester passes traversal AND appears in
//     the target's mode-specific list.
//   { allowed: false, error: 'Permission denied' } otherwise.
//
// Root bypass: userType === 'root' always passes regardless of target
// or parent chain. Mirrors the historical client behavior (load-bearing
// for gameplay — root in this game is the privilege escalation goal,
// not a separate concern from filesystem ACLs).
//
// Why a single function with mode dispatch (vs. three independent
// canRead/canWrite/canExecute functions): the parent-chain traversal
// rule is identical across modes (always parent.execute), and the
// target check is symmetric (target[mode]). One function with property
// tests covers the matrix; three would duplicate logic and risk drift.

export type PermissionMode = 'read' | 'write' | 'execute';

export type PermissionInput = {
  readonly userType: UserType;
  readonly mode: PermissionMode;
  readonly target: FilePermissions;
  readonly parentChain: readonly FilePermissions[];
};

export const checkPermission = ({
  userType,
  mode,
  target,
  parentChain,
}: PermissionInput): PermissionResult => {
  if (userType === 'root') return { allowed: true };

  for (const parent of parentChain) {
    if (!parent.execute.includes(userType)) {
      return { allowed: false, error: 'Permission denied' };
    }
  }

  if (!target[mode].includes(userType)) {
    return { allowed: false, error: 'Permission denied' };
  }

  return { allowed: true };
};

// Mode-specific wrappers for call-site clarity. Same parent-chain rule;
// only the target list under inspection differs.
type ModelessInput = Omit<PermissionInput, 'mode'>;

export const canRead = (input: ModelessInput): PermissionResult =>
  checkPermission({ ...input, mode: 'read' });

export const canWrite = (input: ModelessInput): PermissionResult =>
  checkPermission({ ...input, mode: 'write' });

export const canExecute = (input: ModelessInput): PermissionResult =>
  checkPermission({ ...input, mode: 'execute' });
