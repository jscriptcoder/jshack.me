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
 * Resolve the source IP that should appear in remote machine logs.
 * - On a remote machine (not localhost): the machine's IP is already correct.
 * - On localhost, same /24 subnet as target: LAN IP (direct local network visibility).
 * - On localhost, different network: router's public IP (NAT'd through gateway).
 */
export const resolveLogSourceIP = (
  sessionMachine: string,
  targetIP: string,
  localIP: string,
  publicIP: string | null,
): string => {
  if (sessionMachine !== 'localhost') return sessionMachine;

  // Same /24 subnet → target sees our LAN IP
  if (getSubnet(localIP) === getSubnet(targetIP)) return localIP;

  // Different network → target sees our router's public IP
  return publicIP ?? localIP;
};
