/**
 * The database accounts a generated box's mysqld answers to.
 *
 * What a database HOLDS is `databaseApps.ts`; this is only who may sign in to the
 * server itself, which is a different question from who signs in to the application
 * behind it.
 */

/** The account a database runs its application as — never a system account, which is
 *  the whole point of the door: `/etc/passwd` cannot answer who you are to a database. */
export const MYSQL_USERNAMES: readonly string[] = [
  'app_user',
  'webapp',
  'db_admin',
  'service',
  'api_svc',
  'backup_svc',
  'data_admin',
  'app_rw',
];
