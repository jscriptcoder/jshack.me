/**
 * What the operator's story file says, and what the script prints around posting it.
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

const BYTE_ORDER_MARK = '\uFEFF';

/** A control character, a line break included: a header is one line, so it holds none. */
const CONTROL = /\p{Cc}/u;

/** A control character other than the line break, which a body may hold. */
const BODY_CONTROL = /(?!\n)\p{Cc}/u;

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
  const control = (field === 'body' ? BODY_CONTROL : CONTROL).exec(value);
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

/** The lines of `lines` between its first and its last line that is not blank. */
const withoutBlankEnds = (lines: readonly string[]): readonly string[] => {
  const first = lines.findIndex((line) => !isBlank(line));
  if (first === -1) return [];
  const last = lines.findLastIndex((line) => !isBlank(line));
  return lines.slice(first, last + 1);
};

/** The story `text` holds, or why it holds none. */
export const readStoryFile = (text: string): StoryFileReading => {
  const unmarked = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  const lines = unmarked.replace(/\r\n/g, '\n').split('\n');
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

/** The line printed before a story is posted: what it is, where it goes, and the database
 *  it goes to, the one guard against posting to the wrong one. */
export const postingLine = (story: Story, host: string): string =>
  `Posting "${story.title}" to /${story.section} as ${story.byline} on ${host}`;

/** The line printed once a story is up: its id, which `edit` and `remove` take, and the
 *  address a reader opens it at. */
export const postedLine = (id: number): string =>
  `Posted story ${id}: http://valleynews.io/story?id=${id}`;
