import { describe, expect, it } from 'vitest';
import { ownDatabase } from './ownDatabase';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { drawDatabaseCredentials } from '../generation/generateDatabase';
import { accountIn } from '../sessions/passwdAccount';
import { asEpochMs } from '../types';

const BOX = { machineName: 'cracklab', username: 'neo', rootPassword: 'hunter2' };

/** 2026-09-22 14:05:09 UTC: the moment the player bought the database. */
const INSTALLED_AT = asEpochMs(Date.UTC(2026, 8, 22, 14, 5, 9));

const databaseFor = (ownerKeyHex: string) =>
  ownDatabase({
    ownerKeyHex,
    hostname: BOX.machineName,
    fs: buildWorkstationBaseFs(ownerKeyHex, BOX),
    installedAt: INSTALLED_AT,
  });

describe('the database a player buys', () => {
  it('is a fresh install: one users table whose only row is the box’s owner', () => {
    // Nobody else has ever used a database the player has just installed, so it holds
    // no application and no colleagues — only the account that installed it.
    const database = databaseFor('a'.repeat(64));

    expect(Object.keys(database.tables)).toEqual(['users']);
    expect(database.tables['users']?.rows).toEqual([
      {
        id: 1,
        username: 'neo',
        email: 'neo@cracklab',
        password_hash: expect.stringMatching(/^\$2y\$10\$[./A-Za-z0-9]{53}$/),
        role: 'admin',
        created_at: '2026-09-22 14:05:09',
      },
    ]);
    expect(database.tables['users']?.columns.map((column) => column.name)).toEqual([
      'id',
      'username',
      'email',
      'password_hash',
      'role',
      'created_at',
    ]);
  });

  it('gives every player their own password hash for their own row', () => {
    const first = databaseFor('a'.repeat(64)).tables['users']?.rows[0]?.['password_hash'];
    const second = databaseFor('b'.repeat(64)).tables['users']?.rows[0]?.['password_hash'];

    expect(first).not.toEqual(second);
  });

  it('keeps the drawn accounts beneath a root that answers to the box’s own root password', () => {
    const ownerKeyHex = 'a'.repeat(64);
    const drawn = drawDatabaseCredentials(`mysql-db-own-${ownerKeyHex}`);
    const box = buildWorkstationBaseFs(ownerKeyHex, BOX);
    const database = ownDatabase({
      ownerKeyHex,
      hostname: BOX.machineName,
      fs: box,
      installedAt: INSTALLED_AT,
    });

    expect(database.credentials.slice(1)).toEqual(drawn.slice(1));
    expect(database.credentials[0]).toEqual({
      username: 'root',
      passwordHash: accountIn(box, 'root')?.hash,
      userType: 'root',
    });
  });
});
