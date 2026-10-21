import { describe, expect, it } from 'vitest';
import { postedLine, postingLine, readStoryFile } from './storyFile.js';

/**
 * What the operator's story file says, read before anything is posted. Nothing checks a
 * story again on its way to the paper, so a file that is not exactly a story is refused
 * with the reason, never guessed at; what an editor adds on its own, a CRLF or a byte-order
 * mark, is read through.
 */

type StoryFileParts = {
  readonly headers: readonly string[];
  readonly body: string;
};

const storyFileText = (overrides?: Partial<StoryFileParts>): string => {
  const parts: StoryFileParts = {
    headers: ['section: wire', 'title: A router flaw nobody patched', 'byline: The wire desk'],
    body: 'First paragraph.\n\nSource: The Record - https://therecord.media/a-router-flaw',
    ...overrides,
  };
  return `${parts.headers.join('\n')}\n\n${parts.body}\n`;
};

describe('reading a story file', () => {
  it('reads the section, title, byline and body', () => {
    expect(readStoryFile(storyFileText())).toEqual({
      ok: true,
      story: {
        section: 'wire',
        title: 'A router flaw nobody patched',
        byline: 'The wire desk',
        body: 'First paragraph.\n\nSource: The Record - https://therecord.media/a-router-flaw',
      },
    });
  });

  it.each(['valley', 'dev', 'wire'])('reads the %s section', (section) => {
    expect(
      readStoryFile(
        storyFileText({ headers: [`section: ${section}`, 'title: A title', 'byline: A byline'] }),
      ),
    ).toMatchObject({ ok: true, story: { section } });
  });

  it('reads the headers in any order', () => {
    expect(
      readStoryFile(
        storyFileText({ headers: ['byline: Mara Ellis', 'title: Fog', 'section: valley'] }),
      ),
    ).toMatchObject({
      ok: true,
      story: { section: 'valley', title: 'Fog', byline: 'Mara Ellis' },
    });
  });

  it('trims each header value, and keeps a colon inside it', () => {
    expect(
      readStoryFile(
        storyFileText({
          headers: ['section:   dev  ', 'title:  Patch notes: v0.423.0 ', 'byline:jscriptcoder'],
        }),
      ),
    ).toMatchObject({
      ok: true,
      story: { section: 'dev', title: 'Patch notes: v0.423.0', byline: 'jscriptcoder' },
    });
  });

  it('reads a header with blanks around its name', () => {
    expect(
      readStoryFile(storyFileText({ headers: ['section : dev', ' title: Fog', 'byline :Mara'] })),
    ).toMatchObject({ ok: true, story: { section: 'dev', title: 'Fog', byline: 'Mara' } });
  });

  it('ends the headers at a line of spaces as at an empty one', () => {
    expect(readStoryFile('section: dev\ntitle: Fog\nbyline: Mara\n   \nThe story.')).toMatchObject({
      ok: true,
      story: { body: 'The story.' },
    });
  });

  it('keeps the body as written, its own blank lines and line breaks included', () => {
    const body = 'One line\nwrapped here.\n\n\nAnother paragraph,  spaced.';
    expect(readStoryFile(storyFileText({ body }))).toMatchObject({ ok: true, story: { body } });
  });

  it('drops the blank lines before and after the body', () => {
    expect(readStoryFile(storyFileText({ body: '\n  \nThe story.\n\n \n' }))).toMatchObject({
      ok: true,
      story: { body: 'The story.' },
    });
  });

  it('reads a file saved with CRLF line ends as its LF twin', () => {
    const text = storyFileText({ body: 'One.\n\nTwo.' });
    expect(readStoryFile(text.replace(/\n/g, '\r\n'))).toEqual(readStoryFile(text));
  });

  it('reads a file that starts with a byte-order mark', () => {
    const text = storyFileText();
    expect(readStoryFile(`\uFEFF${text}`)).toEqual(readStoryFile(text));
  });

  it('takes a title, byline and body exactly at their limits, counting characters', () => {
    // A newspaper is two UTF-16 units and one character, as the table counts it.
    const title = '\u{1F4F0}'.repeat(120);
    const byline = 'b'.repeat(60);
    const body = 'c'.repeat(20000);
    expect(
      readStoryFile(
        storyFileText({ headers: ['section: wire', `title: ${title}`, `byline: ${byline}`], body }),
      ),
    ).toMatchObject({ ok: true, story: { title, byline, body } });
  });
});

describe('refusing a file that is not a story', () => {
  it.each([
    ['no section', ['title: A title', 'byline: A byline'], 'Missing header "section"'],
    ['no title', ['section: wire', 'byline: A byline'], 'Missing header "title"'],
    ['no byline', ['section: wire', 'title: A title'], 'Missing header "byline"'],
    [
      'a repeated header',
      ['section: wire', 'title: One', 'title: Two', 'byline: A byline'],
      'Header "title" appears twice',
    ],
    [
      'an unknown header',
      ['section: wire', 'title: A title', 'byline: A byline', 'date: 2026-10-21'],
      'Unknown header "date": a story has section, title and byline',
    ],
    [
      'a header in capitals',
      ['Section: wire', 'title: A title', 'byline: A byline'],
      'Unknown header "Section": a story has section, title and byline',
    ],
    [
      'a header line with no colon',
      ['section: wire', 'title A title', 'byline: A byline'],
      'Not a header: "title A title"',
    ],
    [
      'an unknown section',
      ['section: news', 'title: A title', 'byline: A byline'],
      'Unknown section "news": it is valley, dev or wire',
    ],
    [
      'a section in capitals',
      ['section: Wire', 'title: A title', 'byline: A byline'],
      'Unknown section "Wire": it is valley, dev or wire',
    ],
    ['an empty title', ['section: wire', 'title:  ', 'byline: A byline'], 'The title is empty'],
    ['an empty byline', ['section: wire', 'title: A title', 'byline:'], 'The byline is empty'],
  ])('refuses %s', (_case, headers, reason) => {
    expect(readStoryFile(storyFileText({ headers }))).toEqual({ ok: false, reason });
  });

  it('refuses a file with no blank line after its headers', () => {
    expect(readStoryFile('section: wire\ntitle: A title\nbyline: A byline\n')).toEqual({
      ok: false,
      reason: 'The body is empty',
    });
  });

  it('refuses a file that ends on its last header, with no line break after it', () => {
    expect(readStoryFile('section: wire\ntitle: A title\nbyline: A byline')).toEqual({
      ok: false,
      reason: 'The body is empty',
    });
  });

  it('refuses a body of blank lines', () => {
    expect(readStoryFile(storyFileText({ body: ' \n\n  ' }))).toEqual({
      ok: false,
      reason: 'The body is empty',
    });
  });

  it('refuses an empty file', () => {
    expect(readStoryFile('')).toEqual({ ok: false, reason: 'Missing header "section"' });
  });

  it.each([
    ['title', 121, 120],
    ['byline', 61, 60],
  ])('refuses a %s one character over its limit', (field, length, limit) => {
    const headers = ['section: wire', 'title: A title', 'byline: A byline'].map((header) =>
      header.startsWith(`${field}:`) ? `${field}: ${'\u{1F4F0}'.repeat(length)}` : header,
    );
    expect(readStoryFile(storyFileText({ headers }))).toEqual({
      ok: false,
      reason: `The ${field} is ${length} characters, over ${limit}`,
    });
  });

  it('refuses a body one character over its limit', () => {
    expect(readStoryFile(storyFileText({ body: 'c'.repeat(20001) }))).toEqual({
      ok: false,
      reason: 'The body is 20001 characters, over 20000',
    });
  });

  it.each([
    [
      'a tab in the body',
      { body: 'Before\tafter.' },
      'The body holds a control character, \\u0009',
    ],
    [
      'an escape in the body',
      { body: 'A \u001b[31mred\u001b[0m word.' },
      'The body holds a control character, \\u001b',
    ],
    [
      'a delete in the body',
      { body: 'Gone\u007f.' },
      'The body holds a control character, \\u007f',
    ],
    [
      'a lone carriage return in the body',
      { body: 'One\rtwo.' },
      'The body holds a control character, \\u000d',
    ],
    [
      'a tab in the title',
      { headers: ['section: wire', 'title: A\ttitle', 'byline: A byline'] },
      'The title holds a control character, \\u0009',
    ],
    [
      'a NUL in the byline',
      { headers: ['section: wire', 'title: A title', 'byline: A\u0000byline'] },
      'The byline holds a control character, \\u0000',
    ],
  ])('refuses %s', (_case, overrides, reason) => {
    expect(readStoryFile(storyFileText(overrides))).toEqual({ ok: false, reason });
  });
});

describe('what the script prints', () => {
  it('names the story, its section, its byline and the database before posting', () => {
    expect(
      postingLine(
        {
          section: 'wire',
          title: 'A router flaw nobody patched',
          byline: 'The wire desk',
          body: 'x',
        },
        'db.example.co',
      ),
    ).toBe('Posting "A router flaw nobody patched" to /wire as The wire desk on db.example.co');
  });

  it("names the posted story's id and address", () => {
    expect(postedLine(42)).toBe('Posted story 42: http://valleynews.io/story?id=42');
  });
});
