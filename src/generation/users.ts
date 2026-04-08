import type { Prng } from './prng';
import type { CredentialMap, GeneratedMachine } from './types';
import type { RemoteUser } from '../network/types';
import { md5 } from '../utils/md5';
import { guestPasswords, passwords, wordlistPasswords, usernamesByRole } from './pools';

type UsersResult = {
  readonly usersByMachine: Readonly<Record<string, readonly RemoteUser[]>>;
  readonly credentials: CredentialMap;
};

export const generateUsers = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  entryPoint: string,
): UsersResult => {
  const usersByMachine: Record<string, readonly RemoteUser[]> = {};
  const credentials: Record<
    string,
    readonly { readonly username: string; readonly password: string }[]
  > = {};

  machines.forEach((machine) => {
    const isEntry = machine.ip === entryPoint;
    const roleUsernames = usernamesByRole[machine.role];
    const regularCount = prng.nextInt(1, 2);
    const selectedNames = prng.pickN(roleUsernames, regularCount);

    // FTP-entry machines: SSH passwords from MISSION_PASSWORDS (not in wordlist, not crackable).
    // All other machines: SSH passwords from WORDLIST_PASSWORDS (in wordlist, crackable via hydra).
    // Root always from MISSION_PASSWORDS (never crackable by hydra).
    const isFtpEntry = isEntry && machine.accessVariant === 'ftp';
    const regularPool = isFtpEntry ? passwords : wordlistPasswords;
    const machinePasswords = [
      prng.pick(passwords), // root password always from MISSION_PASSWORDS
      ...prng.pickN(regularPool, regularCount),
    ];
    const rootPassword = machinePasswords[0] as string;

    const rootUser: RemoteUser = {
      username: 'root',
      passwordHash: md5(rootPassword),
      userType: 'root',
    };

    const regularUsers: readonly RemoteUser[] = selectedNames.map((name, i) => ({
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

    const hasGuest = isEntry || prng.next() < 0.5;
    // FTP-entry: guest SSH password from MISSION_PASSWORDS (not crackable by hydra),
    // so the player can't bypass FTP by cracking guest on SSH.
    const guestPassword = isFtpEntry ? prng.pick(passwords) : prng.pick(guestPasswords);
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
