export type RedisStore = Readonly<Record<string, string>>;

export type ParsedRedisCommand =
  | { readonly type: 'keys'; readonly pattern: string }
  | { readonly type: 'get'; readonly key: string }
  | { readonly type: 'set'; readonly key: string; readonly value: string }
  | { readonly type: 'del'; readonly key: string }
  | { readonly type: 'dbsize' }
  | { readonly type: 'auth'; readonly password: string }
  | { readonly type: 'quit' };

export type RedisReadResult = {
  readonly kind: 'read';
  readonly output: string;
};

export type RedisMutationResult = {
  readonly kind: 'mutation';
  readonly output: string;
  readonly mutatedStore: RedisStore;
};

export type RedisResult = RedisReadResult | RedisMutationResult;
