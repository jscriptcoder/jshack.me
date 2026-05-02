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

/**
 * Resolve the source IP that should appear in remote machine logs.
 * - On a remote machine (SSH session): the remote machine's IP is
 *   already in `sessionMachine` — pass through.
 * - On the player's own workstation: always the home network's public
 *   IP. We deliberately do NOT use the LAN IP for same-/24 targets:
 *   a single public-IP identity makes player tracking consistent across
 *   every log file in the world (mission, themed, home), and avoids
 *   leaking ambiguous LAN IPs that aren't unique across players. Falls
 *   back to localIP only when no home network is connected.
 *
 * Pre-PR-#94 the "on own workstation" check used the literal string
 * 'localhost'. After workstations got identity-derived hostnames
 * (workstation_id), that check silently failed and the function
 * leaked the workstation hostname into logs. The fix takes
 * `ownWorkstationId` explicitly so the comparison stays correct.
 */
export const resolveLogSourceIP = (
  sessionMachine: string,
  ownWorkstationId: string,
  localIP: string,
  publicIP: string | null,
): string => {
  if (sessionMachine !== ownWorkstationId) return sessionMachine;
  return publicIP ?? localIP;
};
