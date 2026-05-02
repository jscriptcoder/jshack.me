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

/** Extract the /24 subnet prefix from an IP address (e.g., "10.45.12.100" → "10.45.12"). */
const getSubnet = (ip: string): string => ip.split('.').slice(0, 3).join('.');

/**
 * Resolve the source IP that should appear in remote machine logs —
 * mirrors how a real network would record the source of an incoming
 * packet:
 *
 * - On a remote machine (SSH session): the remote machine's IP is
 *   already in `sessionMachine`, pass through.
 * - On own workstation, target on the same /24: LAN IP. Same-LAN
 *   traffic doesn't traverse a NAT — the target sees our LAN IP
 *   directly. This is also gameplay-relevant: a defender watching
 *   logs on a machine they share a LAN with sees the actual LAN IP
 *   of the attacker.
 * - On own workstation, target on a different network: home router's
 *   public IP, since traffic NATs through the gateway.
 * - Fallback (no home network connected): LAN IP, since there's no
 *   public IP to use.
 *
 * Pre-PR-#94 the "on own workstation" check used the literal string
 * 'localhost'. After workstations got identity-derived hostnames
 * (workstation_id), that check silently failed and the function
 * leaked the workstation hostname into logs. The fix takes
 * `ownWorkstationId` explicitly so the comparison stays correct as
 * the format evolves.
 */
export const resolveLogSourceIP = (
  sessionMachine: string,
  ownWorkstationId: string,
  targetIP: string,
  localIP: string,
  publicIP: string | null,
): string => {
  if (sessionMachine !== ownWorkstationId) return sessionMachine;
  if (getSubnet(localIP) === getSubnet(targetIP)) return localIP;
  return publicIP ?? localIP;
};
