/** Generate a random PID in the realistic range 1000–9999. */
export const generatePid = (): number => Math.floor(Math.random() * 9000) + 1000;

/** Resolve a machine ID to a display hostname for log entries. */
export const resolveHostname = (
  machineId: string,
  getMachine: (ip: string) => { readonly hostname: string } | undefined,
): string => {
  if (machineId === 'localhost') return 'localhost';
  return getMachine(machineId)?.hostname ?? machineId;
};
