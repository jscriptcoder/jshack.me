import type { Prng } from './prng';
import type { EntryVariant, GeneratedMachine, MissionObjectiveType } from './types';
import type { Port, RemoteUser, ServiceOwner } from '../network/types';
import { backdoorPorts, vulnerabilityTemplates } from './pools';

// Picks an owner type for NC/exploit port owners with weighted distribution:
// guest (60%), user (30%), root (10%). Adds difficulty variety to restricted shells.
export const pickOwnerType = (prng: Prng): 'root' | 'user' | 'guest' => {
  const roll = prng.next();
  if (roll < 0.6) return 'guest';
  if (roll < 0.9) return 'user';
  return 'root';
};

// Finds a user matching the preferred type, falling back to other types if needed.
// All machines have root + at least one user, so this always returns a match.
export const findUserByType = (
  users: readonly RemoteUser[],
  preferredType: 'root' | 'user' | 'guest',
): RemoteUser | undefined => {
  const fallbacksByType: Record<string, readonly ('root' | 'user' | 'guest')[]> = {
    guest: ['user', 'root'],
    user: ['guest', 'root'],
    root: ['user', 'guest'],
  };
  const typeOrder = [preferredType, ...(fallbacksByType[preferredType] ?? [])];
  return typeOrder.reduce<RemoteUser | undefined>(
    (found, type) => found ?? users.find((u) => u.userType === type),
    undefined,
  );
};

// For NC entry variant: assigns a user as owner of the backdoor port ('elite' service).
// Owner type is picked by PRNG (guest/user) — root is excluded because a backdoor is
// planted by a prior attacker or rogue insider, not by root on their own machine.
export const addNcBackdoorOwner = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  // Backdoors aren't root-owned — remap to user to preserve PRNG sequence
  const effectiveOwnerType = ownerType === 'root' ? 'user' : ownerType;
  const owner = findUserByType(users, effectiveOwnerType);
  if (!owner) return ports;

  return ports.map((p) =>
    p.service === 'elite' && p.open
      ? {
          ...p,
          owner: {
            username: owner.username,
            userType: owner.userType,
            homePath: owner.userType === 'root' ? '/root' : `/home/${owner.username}`,
          },
        }
      : p,
  );
};

// For FTP entry variant: assigns a user as owner of the FTP port (port 21).
// Owner type is picked by PRNG (guest/user/root) for difficulty variety,
// matching the NC/exploit pattern. The FTP login user becomes this owner.
export const addFtpServerOwner = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  const owner = findUserByType(users, ownerType);
  if (!owner) return ports;

  return ports.map((p) =>
    p.service === 'ftp' && p.open
      ? {
          ...p,
          owner: {
            username: owner.username,
            userType: owner.userType,
            homePath: owner.userType === 'root' ? '/root' : `/home/${owner.username}`,
          },
        }
      : p,
  );
};

// For exploit entry variant: attaches a vulnerability and owner to the
// non-SSH open port on the entry machine. Owner type is picked by PRNG
// (guest/user/root) for difficulty variety.
export const addExploitVulnerability = (
  ports: readonly Port[],
  users: readonly RemoteUser[],
  prng: Prng,
): readonly Port[] => {
  const ownerType = pickOwnerType(prng);
  const owner = findUserByType(users, ownerType);
  if (!owner) return ports;

  return ports.map((p) => {
    if (p.service === 'ssh' || !p.open) return p;

    const vuln = vulnerabilityTemplates.find((v) => v.service === p.service);
    if (!vuln) return p;

    return {
      ...p,
      vulnerability: vuln.vulnerability,
      owner: {
        username: owner.username,
        userType: owner.userType,
        homePath: owner.userType === 'root' ? '/root' : `/home/${owner.username}`,
      },
    };
  });
};

// Derives the enrichment flag from a machine's access variant.
// NC, exploit, and FTP variants need port owners/vulnerabilities attached.
export const variantEnrichmentFlag = (variant: EntryVariant): 'nc' | 'exploit' | 'ftp' | null =>
  variant === 'nc' || variant === 'exploit' || variant === 'ftp' ? variant : null;

export const enrichMachineWithUsers = (
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
  prng: Prng,
): GeneratedMachine => {
  const flag = variantEnrichmentFlag(machine.accessVariant);
  return {
    ...machine,
    remoteMachine: {
      ...machine.remoteMachine,
      ports:
        flag === 'nc'
          ? addNcBackdoorOwner(machine.remoteMachine.ports, users, prng)
          : flag === 'exploit'
            ? addExploitVulnerability(machine.remoteMachine.ports, users, prng)
            : flag === 'ftp'
              ? addFtpServerOwner(machine.remoteMachine.ports, users, prng)
              : machine.remoteMachine.ports,
      users,
    },
  };
};

// Applies PRNG-driven port closures to increase lateral movement variety.
// At most one SSH closure and one FTP closure per network. When SSH is closed
// on a machine, FTP port 21 is ensured open and an NC backdoor with root owner
// is guaranteed (existing backdoor upgraded, or new one added). A dual closure
// (~15%) closes both SSH and FTP, adding an NC backdoor with root owner.
// Always consumes 8 PRNG calls for sequence stability.
// When objectiveType is provided, certain objectives skip all closures.
export const applyPortClosures = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  entryPoint: string,
  objectiveType?: MissionObjectiveType,
): readonly GeneratedMachine[] => {
  // Always consume 8 PRNG calls regardless of whether closures apply
  const sshRoll = prng.next();
  const sshTargetIdx = prng.nextInt(0, Math.max(0, machines.length - 1));
  const ftpRoll = prng.next();
  const ftpTargetIdx = prng.nextInt(0, Math.max(0, machines.length - 1));
  const dualRoll = prng.next();
  const dualTargetIdx = prng.nextInt(0, Math.max(0, machines.length - 1));
  const dualBackdoorPort = prng.pick(backdoorPorts);
  const sshBackdoorPort = prng.pick(backdoorPorts);

  // script_fix, sabotage, backdoor, and portforward need SSH shell access — skip all closures
  if (
    objectiveType === 'script_fix' ||
    objectiveType === 'sabotage' ||
    objectiveType === 'backdoor' ||
    objectiveType === 'portforward'
  )
    return machines;

  // Eligible machines: internal (non-gateway), non-entry
  const eligible = machines.filter(
    (m) => m.role !== 'router' && m.role !== 'switch' && m.ip !== entryPoint,
  );
  if (eligible.length === 0) return machines;

  // Dual closure: ~15% chance to close both SSH and FTP, adding an NC backdoor.
  // Skip machines that need specific ports (ssh/ftp variants) or already have
  // a backdoor (nc variant).
  const dualTarget = eligible[dualTargetIdx % eligible.length];
  const dualTargetVariant = dualTarget?.accessVariant;
  const dualVariantBlocked =
    dualTargetVariant === 'ssh' || dualTargetVariant === 'ftp' || dualTargetVariant === 'nc';
  const dualClosureIp = dualRoll < 0.15 && !dualVariantBlocked ? dualTarget?.ip : undefined;

  const sshTarget = eligible[sshTargetIdx % eligible.length];
  const sshClosureIp =
    sshRoll < 0.3 && sshTarget?.accessVariant !== 'ssh' && sshTarget?.ip !== dualClosureIp
      ? sshTarget?.ip
      : undefined;
  const ftpTarget = eligible[ftpTargetIdx % eligible.length];
  const ftpClosureIp =
    ftpRoll < 0.3 && ftpTarget?.accessVariant !== 'ftp' && ftpTarget?.ip !== dualClosureIp
      ? ftpTarget?.ip
      : undefined;

  // Never close both SSH and FTP on the same machine (unless dual closure)
  const effectiveFtpClosureIp =
    ftpClosureIp !== undefined && ftpClosureIp === sshClosureIp ? undefined : ftpClosureIp;

  if (
    sshClosureIp === undefined &&
    effectiveFtpClosureIp === undefined &&
    dualClosureIp === undefined
  )
    return machines;

  return machines.map((m) => {
    if (m.ip === dualClosureIp) {
      // Dual closure: close SSH and FTP, add NC backdoor with root owner
      const rootUser = m.remoteMachine.users.find((u) => u.userType === 'root');
      const ports: readonly Port[] = [
        ...m.remoteMachine.ports.map((p) =>
          p.port === 22 || p.port === 21 ? { ...p, open: false } : p,
        ),
        {
          port: dualBackdoorPort,
          service: 'elite',
          open: true,
          owner: rootUser
            ? { username: rootUser.username, userType: 'root', homePath: '/root' }
            : undefined,
        },
      ];
      return { ...m, remoteMachine: { ...m.remoteMachine, ports } };
    }

    if (m.ip === sshClosureIp) {
      // Close SSH, ensure FTP port 21 is open, ensure NC backdoor with root owner.
      // Root is required so the player can run `sshd` to re-enable SSH access.
      const rootUser = m.remoteMachine.users.find((u) => u.userType === 'root');
      const rootOwner: ServiceOwner | undefined = rootUser
        ? { username: rootUser.username, userType: 'root', homePath: '/root' }
        : undefined;
      const hasElite = m.remoteMachine.ports.some((p) => p.service === 'elite' && p.open);
      const hasFtp = m.remoteMachine.ports.some((p) => p.port === 21);

      // Close SSH and upgrade any existing backdoor owner to root
      const portsWithClosedSsh = m.remoteMachine.ports.map((p) =>
        p.port === 22
          ? { ...p, open: false }
          : p.service === 'elite' && p.open
            ? { ...p, owner: rootOwner }
            : p,
      );

      // Ensure FTP port 21 is open
      const withFtp = hasFtp
        ? portsWithClosedSsh.map((p) => (p.port === 21 ? { ...p, open: true } : p))
        : [...portsWithClosedSsh, { port: 21, service: 'ftp', open: true }];

      // Add NC backdoor with root owner if none exists
      const ports = hasElite
        ? withFtp
        : [...withFtp, { port: sshBackdoorPort, service: 'elite', open: true, owner: rootOwner }];

      return {
        ...m,
        remoteMachine: { ...m.remoteMachine, ports },
      };
    }

    if (m.ip === effectiveFtpClosureIp) {
      // Close FTP port 21 if present and open (cosmetic — only affects fileservers)
      const hasFtpOpen = m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
      if (!hasFtpOpen) return m;

      return {
        ...m,
        remoteMachine: {
          ...m.remoteMachine,
          ports: m.remoteMachine.ports.map((p) => (p.port === 21 ? { ...p, open: false } : p)),
        },
      };
    }

    return m;
  });
};
