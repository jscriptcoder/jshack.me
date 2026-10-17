/**
 * Reads `JSHACK_SECRETS`, the one environment variable that holds every password pool,
 * into the four lists the game draws from — or into a message naming each rule the
 * value breaks.
 *
 * The pools left the repo so a reader of its history cannot learn the answer key; the
 * price is that they now arrive as a hand-pasted JSON string, on a machine and on
 * Vercel, where no test run looks at them. A slip in that paste would not crash
 * anything: it would ship a world whose difficulty curve is quietly wrong. So the
 * invariants the pools have always had to hold are checked here, at the one place the
 * data enters, and `scripts/encode.ts` refuses to build on any failure.
 *
 * Every broken rule is reported at once, one per line, so one corrected paste fixes
 * them all instead of one per build.
 */

import { z } from 'zod';

const VARIABLE = 'JSHACK_SECRETS';

/** A harvest has to widen coverage a word at a time; below this a handful of finds
 *  would unlock every uncrackable door at once. */
const MIN_UNCRACKABLE_WORDS = 40;

/** The lists the shipped wordlist and the cracked wifi keys put in a player's hands.
 *  An uncrackable word in any of them is a door the roll said should hold. */
const LISTS_A_PLAYER_CAN_READ = [
  'CRACKABLE_PASSWORDS',
  'COMMON_PASSWORDS',
  'WIFI_PASSWORDS',
] as const satisfies readonly ListKey[];

const wordList = z.array(z.string({ error: 'must be a list of words' }), {
  error: (issue) => (issue.input === undefined ? 'missing' : 'must be a list of words'),
});

const secretsSchema = z.strictObject(
  {
    UNCRACKABLE_PASSWORDS: wordList,
    CRACKABLE_PASSWORDS: wordList,
    COMMON_PASSWORDS: wordList,
    WIFI_PASSWORDS: wordList,
  },
  { error: 'must be a JSON object' },
);

const LIST_KEYS = secretsSchema.keyof().options;

type ListKey = (typeof LIST_KEYS)[number];

export type Secrets = { readonly [key in ListKey]: readonly string[] };

export type ParsedSecrets =
  | { readonly ok: true; readonly secrets: Secrets }
  | { readonly ok: false; readonly error: string };

const problem = (key: string | null, reason: string): string =>
  key === null ? `${VARIABLE}: ${reason}` : `${VARIABLE}.${key}: ${reason}`;

const shapeProblems = (issues: readonly z.core.$ZodIssue[]): string[] => {
  const lines = issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => problem(key, 'not a known list'));
    }
    const [key] = issue.path;
    return [problem(key === undefined ? null : String(key), issue.message)];
  });
  return [...new Set(lines)];
};

const listProblems = (key: ListKey, words: readonly string[]): string[] => {
  if (words.length === 0) return [problem(key, 'empty')];
  const blank = words.some((word) => word.trim() === '')
    ? [problem(key, 'holds a blank word')]
    : [];
  const padded = words
    .filter((word) => word.trim() !== '' && word.trim() !== word)
    .map((word) => problem(key, `${JSON.stringify(word)} has spaces around it`));
  const repeated = [...new Set(words.filter((word, index) => words.indexOf(word) !== index))].map(
    (word) => problem(key, `${JSON.stringify(word)} appears more than once`),
  );
  return [...blank, ...padded, ...repeated];
};

const uncrackableProblems = (secrets: Secrets): string[] => {
  const uncrackable = secrets.UNCRACKABLE_PASSWORDS;
  const crackableCount = secrets.CRACKABLE_PASSWORDS.length;
  const tooFew =
    uncrackable.length < MIN_UNCRACKABLE_WORDS
      ? [
          problem(
            'UNCRACKABLE_PASSWORDS',
            `${uncrackable.length} words, needs at least ${MIN_UNCRACKABLE_WORDS}`,
          ),
        ]
      : [];
  const outnumbered =
    uncrackable.length <= crackableCount
      ? [
          problem(
            'UNCRACKABLE_PASSWORDS',
            `${uncrackable.length} words, needs more than CRACKABLE_PASSWORDS (${crackableCount})`,
          ),
        ]
      : [];
  const leaked = LISTS_A_PLAYER_CAN_READ.flatMap((key) =>
    uncrackable
      .filter((word) => secrets[key].includes(word))
      .map((word) => problem('UNCRACKABLE_PASSWORDS', `${JSON.stringify(word)} is also in ${key}`)),
  );
  return [...tooFew, ...outnumbered, ...leaked];
};

/** The parsed value, boxed so that a value of `null` is not mistaken for a failed parse. */
const parseJson = (raw: string): { readonly value: unknown } | null => {
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return null;
  }
};

export const parseSecrets = (raw: string | undefined): ParsedSecrets => {
  if (raw === undefined || raw === '') return { ok: false, error: problem(null, 'not set') };
  const json = parseJson(raw);
  if (json === null) return { ok: false, error: problem(null, 'not valid JSON') };

  const shaped = secretsSchema.safeParse(json.value);
  if (!shaped.success) return { ok: false, error: shapeProblems(shaped.error.issues).join('\n') };

  const secrets = shaped.data;
  const problems = [
    ...LIST_KEYS.flatMap((key) => listProblems(key, secrets[key])),
    ...uncrackableProblems(secrets),
  ];
  return problems.length === 0 ? { ok: true, secrets } : { ok: false, error: problems.join('\n') };
};
