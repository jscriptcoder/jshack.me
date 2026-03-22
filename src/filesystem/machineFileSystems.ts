// Lightweight utility module — static machine filesystems have been replaced
// by runtime generation (generateLocalhost + generateHomeNetwork).

export type MachineId = string;

// _machineId is unused today (all machines use the same /home/username convention)
// but kept in the signature so callers pass it — allows per-machine home paths later
// without changing every call site
export const getDefaultHomePath = (_machineId: string, username: string): string => {
  if (username === 'root') return '/root';
  return `/home/${username}`;
};
