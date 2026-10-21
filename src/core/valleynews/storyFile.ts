/**
 * The operator's desk at valleynews.io: the order they type, the story file it names, and
 * what the script prints around posting, editing or removing a story.
 *
 * A story file is three headers, `section:`, `title:` and `byline:`, in any order, a blank
 * line, then the body. Nothing checks a story again on its way to the paper, so a file that
 * is not exactly a story is refused with its reason, never guessed at. What an editor adds
 * on its own, a CRLF or a byte-order mark, is read through. The limits and the control
 * characters refused are the stories table's own CHECKs, so the script refuses what the
 * table would, before it is asked.
 */

/** The paper's sections, as a story file and the stories table name them. */
export const NEWS_SECTIONS = ['valley', 'dev', 'wire'] as const;

export type NewsSection = (typeof NEWS_SECTIONS)[number];

/** A story id, as a reader's address and the operator's order spell it: no sign, no leading
 *  zero, and short enough to stay exact as a number. */
export const STORY_ID = /^[1-9][0-9]{0,14}$/;

export type Story = {
  readonly section: NewsSection;
  readonly title: string;
  readonly byline: string;
  readonly body: string;
};

export type StoryFileReading =
  | { readonly ok: true; readonly story: Story }
  | { readonly ok: false; readonly reason: string };

type HeaderName = 'section' | 'title' | 'byline';

const HEADER_NAMES: readonly HeaderName[] = ['section', 'title', 'byline'];

/** The most characters each field holds, counted as the table counts them: by character,
 *  not by UTF-16 unit. */
const LIMITS = { title: 120, byline: 60, body: 20000 } as const;

/** A control character other than the line break. Only a body has lines to break: a header
 *  is one line, so it never holds one. */
const CONTROL = /(?!\n)\p{Cc}/u;

const isHeaderName = (name: string): name is HeaderName =>
  (HEADER_NAMES as readonly string[]).includes(name);

const isSection = (value: string): value is NewsSection =>
  (NEWS_SECTIONS as readonly string[]).includes(value);

const isBlank = (line: string): boolean => line.trim() === '';

const refused = (reason: string): StoryFileReading => ({ ok: false, reason });

const spelled = (character: string): string =>
  `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;

/** Why `value` cannot be the field it is, or null when it can. */
const fieldFault = (field: 'title' | 'byline' | 'body', value: string): string | null => {
  if (value === '') return `The ${field} is empty`;
  const control = CONTROL.exec(value);
  if (control !== null) return `The ${field} holds a control character, ${spelled(control[0])}`;
  const length = [...value].length;
  return length > LIMITS[field]
    ? `The ${field} is ${length} characters, over ${LIMITS[field]}`
    : null;
};

/** The headers' lines read into their values, or why they cannot be. */
const readHeaders = (
  lines: readonly string[],
): { readonly values: ReadonlyMap<HeaderName, string> } | { readonly reason: string } => {
  const values = new Map<HeaderName, string>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) return { reason: `Not a header: "${line}"` };
    // `trim` also takes off the byte-order mark an editor may put before the first header.
    const name = line.slice(0, colon).trim();
    if (!isHeaderName(name)) {
      return { reason: `Unknown header "${name}": a story has section, title and byline` };
    }
    if (values.has(name)) return { reason: `Header "${name}" appears twice` };
    values.set(name, line.slice(colon + 1).trim());
  }
  const missing = HEADER_NAMES.find((name) => !values.has(name));
  return missing === undefined ? { values } : { reason: `Missing header "${missing}"` };
};

/** The lines of `lines` between its first and its last line that is not blank: none, when
 *  every line is. */
const withoutBlankEnds = (lines: readonly string[]): readonly string[] => {
  const first = lines.findIndex((line) => !isBlank(line));
  const last = lines.findLastIndex((line) => !isBlank(line));
  return lines.slice(first, last + 1);
};

/** The story `text` holds, or why it holds none. */
export const readStoryFile = (text: string): StoryFileReading => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blank = lines.findIndex(isBlank);
  const headerLines = blank === -1 ? lines : lines.slice(0, blank);

  const headers = readHeaders(headerLines);
  if ('reason' in headers) return refused(headers.reason);
  const section = headers.values.get('section') ?? '';
  const title = headers.values.get('title') ?? '';
  const byline = headers.values.get('byline') ?? '';
  if (!isSection(section)) {
    return refused(`Unknown section "${section}": it is valley, dev or wire`);
  }

  const body = blank === -1 ? '' : withoutBlankEnds(lines.slice(blank + 1)).join('\n');
  const fault =
    fieldFault('title', title) ?? fieldFault('byline', byline) ?? fieldFault('body', body);
  return fault === null ? { ok: true, story: { section, title, byline, body } } : refused(fault);
};

export type DeskOrder =
  | { readonly verb: 'post'; readonly file: string }
  | { readonly verb: 'edit'; readonly id: number; readonly file: string }
  | { readonly verb: 'remove'; readonly id: number };

/** What the operator typed after the script's name, or `null` when it is not exactly
 *  `post <file>`, `edit <id> <file>` or `remove <id>`. An id is read by the rule a
 *  reader's address is, so a near miss is refused, never taken for another story. */
export const readDeskOrder = (words: readonly string[]): DeskOrder | null => {
  const [verb, first = '', second = ''] = words;
  if (verb === 'post' && words.length === 2) return { verb, file: first };
  if (!STORY_ID.test(first)) return null;
  const id = Number(first);
  if (verb === 'edit' && words.length === 3) return { verb, id, file: second };
  if (verb === 'remove' && words.length === 2) return { verb, id };
  return null;
};

/** A story as its row stands, named in the line printed before it is changed. */
export type StandingStory = { readonly section: string; readonly title: string };

const storyAddress = (id: number): string => `http://valleynews.io/story?id=${id}`;

/** The line printed before a story is posted: what it is, where it goes, and the database
 *  it goes to, the one guard against posting to the wrong one. */
export const postingLine = (story: Story, host: string): string =>
  `Posting "${story.title}" to /${story.section} as ${story.byline} on ${host}`;

/** The line printed once a story is up: its id, which `edit` and `remove` take, and the
 *  address a reader opens it at. */
export const postedLine = (id: number): string => `Posted story ${id}: ${storyAddress(id)}`;

/** The lines printed before an edit: the story the id names as it stands, so that a
 *  mistyped id shows the wrong story before it is overwritten, and what it becomes. */
export const editingLines = (
  id: number,
  standing: StandingStory,
  story: Story,
  host: string,
): string =>
  `Editing story ${id} "${standing.title}" in /${standing.section} on ${host}:\n` +
  `  now "${story.title}" in /${story.section} as ${story.byline}`;

/** The line printed once a story is edited: its address, the one it always had. */
export const editedLine = (id: number): string => `Edited story ${id}: ${storyAddress(id)}`;

/** The line printed before a removal, naming the story the id names as it stands. */
export const removingLine = (id: number, standing: StandingStory, host: string): string =>
  `Removing story ${id} "${standing.title}" from /${standing.section} on ${host}`;

export const removedLine = (id: number): string => `Removed story ${id}`;

export const noStoryLine = (id: number, host: string): string => `No story ${id} on ${host}`;
