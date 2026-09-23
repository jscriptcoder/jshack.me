import { describe, expect, it } from 'vitest';
import { strings } from '../commands/strings';
import type { TerminalLine } from '../commands/types';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { softwareVersionsIn } from '../../test/worldContent';
import { asAbsPath } from '../types';
import { createPrng } from './prng';
import { renderDocument, type DocumentMetadata } from './documentFormats';

const NO_FLAGS = new Map<string, string | true>();

/** What a player reads with `strings` on a file holding `content` — the real
 *  command's own run extraction, so every claim below is one a player can see. */
const readableLinesOf = async (content: string): Promise<readonly string[]> => {
  const result = await strings.execute(
    mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({ document: buildFile(content, { owner: 'alice' }) }), {
        userType: 'user',
        cwd: asAbsPath('/'),
      }),
    }),
    ['/document'],
    NO_FLAGS,
  );
  if (result.kind !== 'sync') throw new Error('strings answered asynchronously');
  return result.lines
    .filter((line: TerminalLine) => line.kind === 'text')
    .map((line) => line.content);
};

type PdfMetadata = Extract<DocumentMetadata, { readonly format: 'pdf' }>;
type PhotoMetadata = Extract<DocumentMetadata, { readonly format: 'jpeg' }>;

const getPdf = (overrides?: Partial<PdfMetadata>): PdfMetadata => ({
  format: 'pdf',
  title: 'Q2 budget',
  author: 'Maria Rodriguez',
  createdAt: Date.UTC(2026, 3, 2, 10, 29, 2),
  modifiedAt: Date.UTC(2026, 3, 9, 16, 30, 15),
  ...overrides,
});

const getPhoto = (overrides?: Partial<PhotoMetadata>): PhotoMetadata => ({
  format: 'jpeg',
  make: 'Apple',
  model: 'iPhone 13',
  takenAt: Date.UTC(2026, 3, 2, 10, 29, 2),
  artist: 'Maria Rodriguez',
  ...overrides,
});

/** An entry of a PDF's Info dictionary, as `strings` shows it. */
const pdfEntry = (lines: readonly string[], key: string): string | undefined =>
  lines.join('\n').match(new RegExp(`/${key} \\(([^)]*)\\)`))?.[1];

const ALL_FORMATS: readonly DocumentMetadata[] = [
  getPdf(),
  getPhoto(),
  { format: 'docx' },
  { format: 'xlsx' },
];

describe('a document on a share is the real format, not text wearing its name', () => {
  it('a PDF gives up who wrote it, its title and when, through strings', async () => {
    const lines = await readableLinesOf(renderDocument(getPdf(), createPrng('pdf')));

    expect(lines[0]).toBe('%PDF-1.7');
    expect(pdfEntry(lines, 'Author')).toBe('Maria Rodriguez');
    expect(pdfEntry(lines, 'Title')).toBe('Q2 budget');
    expect(pdfEntry(lines, 'CreationDate')).toBe('D:20260402102902Z');
    expect(pdfEntry(lines, 'ModDate')).toBe('D:20260409163015Z');
    expect(lines.at(-1)).toBe('%%EOF');
  });

  it('a PDF pads every date field to its fixed width', async () => {
    const lines = await readableLinesOf(
      renderDocument(
        getPdf({
          createdAt: Date.UTC(2025, 0, 3, 4, 5, 6),
          modifiedAt: Date.UTC(2025, 10, 23, 21, 0, 9),
        }),
        createPrng('pdf'),
      ),
    );

    expect(pdfEntry(lines, 'CreationDate')).toBe('D:20250103040506Z');
    expect(pdfEntry(lines, 'ModDate')).toBe('D:20251123210009Z');
  });

  it('a PDF cross-reference table points at the objects it indexes', () => {
    const content = renderDocument(getPdf(), createPrng('pdf'));

    const offsets = [...content.matchAll(/^(\d{10}) 00000 n $/gm)].map((entry) =>
      Number(entry[1]),
    );
    expect(offsets.map((offset) => content.slice(offset, offset + 7))).toEqual([
      '1 0 obj',
      '2 0 obj',
      '3 0 obj',
      '4 0 obj',
      '5 0 obj',
    ]);
    const startxref = Number(content.match(/startxref\n(\d+)\n/)?.[1]);
    expect(content.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('a PDF names no software version, only its format', async () => {
    const lines = await readableLinesOf(renderDocument(getPdf(), createPrng('pdf')));

    expect(softwareVersionsIn(lines.slice(1).join('\n'))).toEqual([]);
  });

  it('a photo gives up the camera, the moment and who took it, as Exif does', async () => {
    const lines = await readableLinesOf(renderDocument(getPhoto(), createPrng('jpeg')));

    expect(lines).toEqual([
      'JFIF',
      'Exif',
      'Apple',
      'iPhone 13',
      '2026:04:02 10:29:02',
      'Maria Rodriguez',
    ]);
  });

  it('a photo nobody signed carries no artist', async () => {
    const lines = await readableLinesOf(
      renderDocument(
        getPhoto({ artist: null, takenAt: Date.UTC(2025, 8, 1, 7, 3, 9) }),
        createPrng('jpeg'),
      ),
    );

    expect(lines).toEqual(['JFIF', 'Exif', 'Apple', 'iPhone 13', '2025:09:01 07:03:09']);
  });

  it('a Word document gives up its zip member names and nothing about who wrote it', async () => {
    const lines = await readableLinesOf(renderDocument({ format: 'docx' }, createPrng('docx')));

    // Word deflates every member, the author's core.xml included, so a real
    // `strings` on a real docx finds the names in the local headers and again
    // in the central directory, and no person.
    const members = [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'word/document.xml',
    ];
    expect(lines).toEqual([...members, ...members]);
  });

  it('a spreadsheet gives up its workbook members and nothing else', async () => {
    const lines = await readableLinesOf(renderDocument({ format: 'xlsx' }, createPrng('xlsx')));

    const members = [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/sharedStrings.xml',
    ];
    expect(lines).toEqual([...members, ...members]);
  });

  it.each(ALL_FORMATS)('a $format holds no NUL, which the patch store cannot keep', (metadata) => {
    expect(renderDocument(metadata, createPrng('nul')).includes('\u0000')).toBe(false);
  });

  it.each(ALL_FORMATS)(
    'a $format is mostly noise to cat, and the noise hides nothing strings would find',
    async (metadata) => {
      const oneRender = renderDocument(metadata, createPrng('one'));
      const another = renderDocument(metadata, createPrng('another'));

      expect(oneRender).not.toBe(another);
      // Lengths and offsets are numbers the format really states, and they move
      // with the noise's size; anything else readable that moved came from noise.
      const withoutNumbers = async (content: string) =>
        (await readableLinesOf(content)).map((line) => line.replace(/\d+/g, '#'));
      expect(await withoutNumbers(oneRender)).toEqual(await withoutNumbers(another));
      const unreadable = [...oneRender].filter((character) => {
        const code = character.charCodeAt(0);
        return code < 32 ? code !== 9 && code !== 10 : code > 126;
      });
      expect(unreadable.length).toBeGreaterThanOrEqual(64);
    },
  );

  it.each(ALL_FORMATS)(
    'a $format carries no carriage return or escape a terminal would act on',
    (metadata) => {
      const content = renderDocument(metadata, createPrng('terminal'));
      expect(content.includes('\r')).toBe(false);
      expect(content.includes('\u001b')).toBe(false);
    },
  );
});
