import { describe, expect, it } from 'vitest';
import { redisStoreSchema, type RedisStore } from './types';
import { runStatement, type StoreStatementResult } from './statements';
import { md5 } from '../generation/md5';

/**
 * What a store answers, and what it refuses.
 *
 * The whole verb surface is seven words, so these tests are the door's contract in
 * full. Two of them matter more than the rest: a store that holds a secret answers
 * NOTHING about its contents until that secret is produced, and a store that holds
 * none answers everyone — which is the entire character of this door rather than a
 * mode it can be put in.
 */

const storeOf = (
  keys: Readonly<Record<string, string>>,
  requirepassHash: string | null = null,
): RedisStore => redisStoreSchema.parse({ keys, requirepassHash });

const answer = (line: string, store: RedisStore): readonly string[] =>
  runStatement({ store, line }).output;

const SESSIONS = storeOf({
  'sess:0a1b2c3d': '{"username":"devops","role":"admin"}',
  'sess:9f8e7d6c': '{"username":"marta","role":"user"}',
  'cache:user:devops': '{"email":"devops@www-07","last_login":1755000000}',
  'stats:requests': '4471',
});

const LOCKED = storeOf({ 'sess:0a1b2c3d': '{"username":"devops"}' }, 'd41d8cd98f00b204e9800998ecf8427e');

describe('reading a store', () => {
  it('lists every key it holds, numbered from one', () => {
    expect(answer('KEYS *', SESSIONS)).toEqual([
      '1) "sess:0a1b2c3d"',
      '2) "sess:9f8e7d6c"',
      '3) "cache:user:devops"',
      '4) "stats:requests"',
    ]);
  });

  it('narrows the list to a glob, so a player can ask for the sessions alone', () => {
    expect(answer('KEYS sess:*', SESSIONS)).toEqual(['1) "sess:0a1b2c3d"', '2) "sess:9f8e7d6c"']);
  });

  it('treats a pattern with no wildcard as the one key it names', () => {
    expect(answer('KEYS stats:requests', SESSIONS)).toEqual(['1) "stats:requests"']);
  });

  it('says a pattern matched nothing rather than saying nothing at all', () => {
    expect(answer('KEYS perms:*', SESSIONS)).toEqual(['(empty list or set)']);
  });

  it('treats every character but * as a literal, so no pattern can be a regex', () => {
    // `?` is a single-character wildcard in real Redis and a quantifier in a regex.
    // Passed through unescaped it is neither — `KEYS ?` becomes `^?$`, which does not
    // compile, and a player would be taking the daemon down by typing a question mark.
    const patterns = ['?', 'sess:?', '(', '[', '+'];
    expect(patterns.map((pattern) => answer(`KEYS ${pattern}`, SESSIONS))).toEqual(
      patterns.map(() => ['(empty list or set)']),
    );
  });

  it('matches a dot in a pattern against a dot, never against any character', () => {
    const dotted = storeOf({ 'cache.user.1': 'a', 'cacheXuserX1': 'b', 'cache:user:1': 'c' });

    // The escaping is the whole of this. Unescaped, `.` is a regex wildcard and this
    // pattern would quietly hand back all three — a player asking for one key and
    // being given somebody else's is worse than being given none.
    expect(answer('KEYS cache.user.1', dotted)).toEqual(['1) "cache.user.1"']);
  });

  it('reads a bare KEYS as KEYS *, because a pattern nobody typed cannot be a filter', () => {
    const listed = answer('KEYS', SESSIONS);
    expect(listed).toEqual(answer('KEYS *', SESSIONS));
    expect(listed).toHaveLength(4);
  });

  it('gives back a value in full, quoted as the client prints one', () => {
    expect(answer('GET sess:0a1b2c3d', SESSIONS)).toEqual([
      '"{"username":"devops","role":"admin"}"',
    ]);
  });

  it('answers nil for a key the store does not hold', () => {
    expect(answer('GET sess:nothing', SESSIONS)).toEqual(['(nil)']);
  });

  it('counts what it holds, and the count agrees with the listing', () => {
    expect(answer('DBSIZE', SESSIONS)).toEqual(['(integer) 4']);
    expect(answer('DBSIZE', storeOf({}))).toEqual(['(integer) 0']);
  });

  it('answers a verb typed in any case, as the real client does', () => {
    expect(answer('keys sess:*', SESSIONS)).toEqual(['1) "sess:0a1b2c3d"', '2) "sess:9f8e7d6c"']);
    expect(answer('get stats:requests', SESSIONS)).toEqual(['"4471"']);
    expect(answer('dbsize', SESSIONS)).toEqual(['(integer) 4']);
  });

  it('reports no failure for anything it could answer, including an empty one', () => {
    const lines = ['KEYS *', 'KEYS perms:*', 'GET sess:nothing', 'DBSIZE'];
    expect(lines.map((line) => runStatement({ store: SESSIONS, line }).failed)).toEqual(
      lines.map(() => false),
    );
  });
});

describe('what a store refuses', () => {
  it('names the word it did not understand, exactly as it was typed', () => {
    expect(runStatement({ store: SESSIONS, line: 'cat /etc/passwd' })).toEqual({
      output: ["(error) ERR unknown command 'cat'"],
      failed: true,
    });
  });

  it('refuses the outer shell wholesale, so no line typed here reaches the box below', () => {
    const outer = ['ls', 'rm -rf /', 'sudo su', 'SELECT * FROM users'];
    expect(outer.map((line) => runStatement({ store: SESSIONS, line }).failed)).toEqual(
      outer.map(() => true),
    );
  });

  it('refuses a verb it knows with an argument missing, naming the verb in lower case', () => {
    expect(answer('GET', SESSIONS)).toEqual([
      "(error) ERR wrong number of arguments for 'get' command",
    ]);
  });

  it('says nothing at all to a blank line, and does not call it a failure', () => {
    expect(runStatement({ store: SESSIONS, line: '   ' })).toEqual({ output: [], failed: false });
  });
});

describe('a store that holds a secret', () => {
  it('answers no read at all before the secret is produced', () => {
    const reads = ['KEYS *', 'GET sess:0a1b2c3d', 'DBSIZE'];
    expect(reads.map((line) => answer(line, LOCKED))).toEqual(
      reads.map(() => ['(error) NOAUTH Authentication required.']),
    );
  });

  it('leaks nothing about what it holds through the refusal', () => {
    const refusal = answer('GET sess:0a1b2c3d', LOCKED).join('\n');
    expect(refusal).toBe('(error) NOAUTH Authentication required.');
    expect(refusal).not.toContain('devops');
    expect(refusal).not.toContain('sess:0a1b2c3d');
  });

  it('gives the same refusal for a key it does not hold as for one it does', () => {
    const missing = answer('GET sess:nothing', LOCKED);
    expect(missing).toEqual(answer('GET sess:0a1b2c3d', LOCKED));
    expect(missing).toEqual(['(error) NOAUTH Authentication required.']);
  });

  it('counts the refusal as a failure, so the terminal draws it as one', () => {
    expect(runStatement({ store: LOCKED, line: 'DBSIZE' }).failed).toBe(true);
  });

  it('still answers an unknown word with the unknown word, as the real daemon does', () => {
    // The command lookup happens before the auth check in real Redis, and legacy
    // parses before it executes — so a typo is a typo whether or not you are in.
    expect(answer('cat /etc/passwd', LOCKED)).toEqual(["(error) ERR unknown command 'cat'"]);
  });
});

describe('producing the secret', () => {
  const SECRET = 'summer2024';
  const SHUT = storeOf(
    { 'sess:0a1b2c3d': '{"username":"devops"}', 'stats:requests': '9' },
    md5(SECRET),
  );

  const reply = (line: string, store: RedisStore, password?: string): StoreStatementResult =>
    runStatement({ store, line, ...(password === undefined ? {} : { password }) });

  it('accepts the password the store holds, and reports the attempt as a success', () => {
    expect(reply(`AUTH ${SECRET}`, SHUT)).toEqual({
      output: ['OK'],
      failed: false,
      attempt: 'success',
    });
  });

  it('refuses a password the store does not hold, and reports the attempt as a failure', () => {
    expect(reply('AUTH winter2024', SHUT)).toEqual({
      output: ['(error) ERR invalid password'],
      failed: true,
      attempt: 'failure',
    });
  });

  it('judges the password exactly, so a near miss is a miss', () => {
    // The hash is the whole comparison. A door that accepted a case fold or a prefix
    // would be crackable by words the wordlist does not hold.
    const near = ['Summer2024', 'summer', 'summer20244'];
    expect(near.map((candidate) => reply(`AUTH ${candidate}`, SHUT).failed)).toEqual(
      near.map(() => true),
    );
    expect(reply(`AUTH ${SECRET}`, SHUT).failed).toBe(false);
  });

  it('refuses a bare AUTH as a verb missing its argument, having judged nothing', () => {
    expect(reply('AUTH', SHUT)).toEqual({
      output: ["(error) ERR wrong number of arguments for 'auth' command"],
      failed: true,
    });
  });

  it('refuses an AUTH carrying more than one word, so the client and the door agree', () => {
    // A password cannot contain a space here — the line is split on whitespace — so a
    // second word is a typo. Accepting it and silently weighing the first would leave
    // the prompt holding nothing while the daemon said OK: authenticated for exactly one
    // statement, and locked out on the next with no way to tell why.
    expect(reply('AUTH summer2024 extra', SHUT)).toEqual({
      output: ["(error) ERR wrong number of arguments for 'auth' command"],
      failed: true,
    });
  });

  it('tells a caller that a store holding no secret has nothing to authenticate against', () => {
    // Nothing was judged here either, so nothing is recorded. A store with no lock
    // cannot produce a failed attempt, and a log line saying it had would be an
    // invention the defender reads as somebody trying.
    expect(reply('AUTH anything', SESSIONS)).toEqual({
      output: ['(error) ERR Client sent AUTH, but no password is set'],
      failed: true,
    });
  });

  it('answers every read once the statement carries the password', () => {
    expect(reply('KEYS *', SHUT, SECRET).output).toEqual([
      '1) "sess:0a1b2c3d"',
      '2) "stats:requests"',
    ]);
    expect(reply('GET stats:requests', SHUT, SECRET).output).toEqual(['"9"']);
    expect(reply('DBSIZE', SHUT, SECRET).output).toEqual(['(integer) 2']);
  });

  it('goes on refusing a statement carrying the wrong password, or none at all', () => {
    const carried = [undefined, '', 'winter2024'];
    expect(carried.map((password) => reply('DBSIZE', SHUT, password).output)).toEqual(
      carried.map(() => ['(error) NOAUTH Authentication required.']),
    );
  });

  it('reports an attempt only for a password being judged', () => {
    const lines = ['KEYS *', 'GET stats:requests', 'DBSIZE', 'cat /etc/passwd', ''];
    expect(lines.map((line) => reply(line, SHUT, SECRET).attempt)).toEqual(
      lines.map(() => undefined),
    );
    expect(reply(`AUTH ${SECRET}`, SHUT).attempt).toBe('success');
  });

  it('takes the verb in any case, as it takes every other', () => {
    expect(reply(`auth ${SECRET}`, SHUT).output).toEqual(['OK']);
  });
});
