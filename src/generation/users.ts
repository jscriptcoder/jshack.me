import type { Prng } from './prng';
import type { CredentialMap, GeneratedMachine } from './types';
import type { RemoteUser } from '../network/types';
import { md5 } from '../utils/md5';
import { guestPasswords, passwords, usernamesByRole } from './pools';

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

    const machinePasswords = prng.pickN(passwords, regularCount + 1);
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
    const guestPassword = prng.pick(guestPasswords);
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
