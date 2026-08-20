/**
 * The shape of a generated database, and the one way to read one back.
 *
 * A database lives as a FILE on the box that serves it (`/var/lib/mysql/data.json`),
 * which makes every read of it a TRUST BOUNDARY rather than an internal hand-off: the
 * file is root-owned, but root on a box is a tier a player can reach, and anything a
 * player can reach they can edit. So this is a schema first and a type second — the
 * types below are derived from it, and nothing else may re-declare them.
 *
 * Legacy read the same file with a bare `as MysqlDatabase` cast. That is exactly the
 * hole this closes: a hand-edited datadir would have flowed straight into the executor
 * as a well-typed lie.
 *
 * Accounts here are NOT the box's accounts. `/etc/passwd` answers who you are on the
 * machine; this answers who you are to the database, and the two are drawn separately
 * on purpose — cracking one buys nothing toward the other.
 */

import { z } from 'zod';

/** The column types the generated schemas use. Narrow on purpose: a type no template
 *  emits is a formatter branch no player can reach. */
export const mysqlColumnTypeSchema = z.enum([
  'INT',
  'VARCHAR',
  'TEXT',
  'DATETIME',
  'BOOLEAN',
  'FLOAT',
]);

export const mysqlColumnSchema = z.object({
  name: z.string(),
  type: mysqlColumnTypeSchema,
  nullable: z.boolean(),
  /** `PRI` for the primary key, `UNI` for a unique one. Absent is the ordinary case. */
  key: z.enum(['PRI', 'UNI']).optional(),
  defaultValue: z.string().optional(),
});

/** One row, as the column set describes it. `null` is a real value here — it is what a
 *  nullable column with nothing in it reads back as, and the formatter prints `NULL`. */
export const mysqlRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const mysqlTableSchema = z.object({
  columns: z.array(mysqlColumnSchema).readonly(),
  rows: z.array(mysqlRowSchema).readonly(),
});

/** A database account. The tier is the database's own and governs which STATEMENTS the
 *  account may run — it confers nothing on the filesystem, which is the whole reason
 *  this door is worth having beside ssh. */
export const mysqlCredentialSchema = z.object({
  username: z.string(),
  passwordHash: z.string(),
  userType: z.enum(['guest', 'user', 'root']),
});

export const mysqlDatabaseSchema = z.object({
  name: z.string(),
  tables: z.record(z.string(), mysqlTableSchema),
  credentials: z.array(mysqlCredentialSchema).readonly(),
});

export type MysqlColumnType = z.infer<typeof mysqlColumnTypeSchema>;
export type MysqlColumn = z.infer<typeof mysqlColumnSchema>;
export type MysqlRow = z.infer<typeof mysqlRowSchema>;
export type MysqlTable = z.infer<typeof mysqlTableSchema>;
export type MysqlCredential = z.infer<typeof mysqlCredentialSchema>;
export type MysqlDatabase = z.infer<typeof mysqlDatabaseSchema>;

/**
 * Read a datadir back, or `null` for anything that is not one.
 *
 * Malformed JSON, a truncated file and a well-formed file describing something else
 * all collapse to the same `null`: from the daemon's side they are one condition —
 * there is no database here — and telling them apart would only tell a player how
 * their tampering failed.
 */
export const parseMysqlDatabase = (content: string): MysqlDatabase | null => {
  const parsed = ((): unknown => {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  })();
  const result = mysqlDatabaseSchema.safeParse(parsed);
  return result.success ? result.data : null;
};
