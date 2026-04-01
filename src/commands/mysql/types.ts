export type MysqlColumnType =
  | 'INT'
  | 'VARCHAR'
  | 'TEXT'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'FLOAT';

export type MysqlColumn = {
  readonly name: string;
  readonly type: MysqlColumnType;
  readonly nullable: boolean;
  readonly key?: 'PRI' | 'UNI';
  readonly defaultValue?: string;
};

export type MysqlRow = Readonly<Record<string, string | number | null>>;

export type MysqlTable = {
  readonly columns: readonly MysqlColumn[];
  readonly rows: readonly MysqlRow[];
};

export type MysqlDatabase = {
  readonly name: string;
  readonly tables: Readonly<Record<string, MysqlTable>>;
};

// Parsed SQL types — discriminated union from the parser
export type WhereClause = {
  readonly column: string;
  readonly value: string;
};

export type SetClause = {
  readonly column: string;
  readonly value: string;
};

export type ParsedSql =
  | { readonly type: 'show_tables' }
  | { readonly type: 'describe'; readonly table: string }
  | {
      readonly type: 'select';
      readonly table: string;
      readonly columns: readonly string[] | '*';
      readonly where: readonly WhereClause[];
    }
  | {
      readonly type: 'update';
      readonly table: string;
      readonly sets: readonly SetClause[];
      readonly where: readonly WhereClause[];
    }
  | { readonly type: 'delete'; readonly table: string; readonly where: readonly WhereClause[] }
  | { readonly type: 'drop_table'; readonly table: string }
  | { readonly type: 'exit' };

// Executor result — either a display string or a mutation with output
export type SqlReadResult = {
  readonly kind: 'read';
  readonly output: string;
};

export type SqlMutationResult = {
  readonly kind: 'mutation';
  readonly output: string;
  readonly mutatedDb: MysqlDatabase;
};

export type SqlResult = SqlReadResult | SqlMutationResult;
