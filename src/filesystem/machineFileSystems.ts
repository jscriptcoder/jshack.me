// Lightweight utility module — static machine filesystems have been replaced
// by runtime generation (generateLocalhost + generateHomeNetwork).

// MachineId is a thin alias for string. Kept as a named alias for documentation
// at boundary points (NAT resolution, session state, persisted patches), even
// though it carries no compile-time enforcement. A future PR can convert this
// to a proper branded type if the value of strict tagging outweighs the
// 100+ call-site adapter cost.
export type MachineId = string;

// _machineId is unused today (all machines use the same /home/username convention)
// but kept in the signature so callers pass it — allows per-machine home paths later
// without changing every call site
export const getDefaultHomePath = (_machineId: string, username: string): string => {
  if (username === 'root') return '/root';
  return `/home/${username}`;
};
