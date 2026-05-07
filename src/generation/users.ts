import type { Prng } from './prng';
import type { CredentialMap, EntryVariant, GeneratedMachine, GeneratedUser } from './types';
import { md5 } from '../utils/md5';
import { guestPasswords, passwords, wordlistPasswords, usernamesByRole } from './pools';

type UsersResult = {
  readonly usersByMachine: Readonly<Record<string, readonly GeneratedUser[]>>;
  readonly credentials: CredentialMap;
};

type GenerateUsersOptions = {
  readonly entryVariant?: EntryVariant;
};

export const generateUsers = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  entryPoint: string,
  options: GenerateUsersOptions = {},
): UsersResult => {
  const usersByMachine: Record<string, readonly GeneratedUser[]> = {};
  const credentials: Record<
    string,
    readonly { readonly username: string; readonly password: string }[]
  > = {};

  machines.forEach((machine) => {
    const isEntry = machine.ip === entryPoint;
    const roleUsernames = usernamesByRole[machine.role];
    const regularCount = prng.nextInt(1, 2);
    const selectedNames = prng.pickN(roleUsernames, regularCount);

    // FTP-entry: the entry machine AND router need non-wordlist SSH passwords,
    // since both are reachable by the player and guest SSH must not be crackable.
    // All other machines: SSH passwords from WORDLIST_PASSWORDS (crackable via hydra).
    // Root always from MISSION_PASSWORDS (never crackable by hydra).
    const isFtpNetwork = options.entryVariant === 'ftp';
    const isFtpFirstHop = isFtpNetwork && (isEntry || machine.role === 'router');
    const regularPool = isFtpFirstHop ? passwords : wordlistPasswords;
    const machinePasswords = [
      prng.pick(passwords), // root password always from MISSION_PASSWORDS
      ...prng.pickN(regularPool, regularCount),
    ];
    const rootPassword = machinePasswords[0] as string;

    const rootUser: GeneratedUser = {
      username: 'root',
      passwordHash: md5(rootPassword),
      userType: 'root',
    };

    const regularUsers: readonly GeneratedUser[] = selectedNames.map((name, i) => ({
      username: name,
      passwordHash: md5(machinePasswords[i + 1] as string),
      userType: 'user' as const,
    }));

    const machineCredentials: { readonly username: string; readonly password: string }[] = [
      { username: 'root', password: rootPassword },
      ...selectedNames.map((name, i) => ({
        username: name,
        password: machinePasswords[i + 1] as string,
      })),
    ];

    // FTP first-hop machines skip guest — guest passwords are always in hydra's
    // wordlist, so a guest user would let the player bypass FTP by cracking guest on SSH.
    // Always consume PRNG calls for sequence stability.
    const guestRoll = prng.next();
    const guestPassword = prng.pick(guestPasswords);
    const hasGuest = isFtpFirstHop ? false : isEntry || guestRoll < 0.5;
    const allUsers = hasGuest
      ? [
          rootUser,
          ...regularUsers,
          {
            username: 'guest',
            passwordHash: md5(guestPassword),
            userType: 'guest' as const,
          },
        ]
      : [rootUser, ...regularUsers];

    if (hasGuest) {
      machineCredentials.push({ username: 'guest', password: guestPassword });
    }

    usersByMachine[machine.ip] = allUsers;
    credentials[machine.ip] = machineCredentials;
  });

  return { usersByMachine, credentials };
};
