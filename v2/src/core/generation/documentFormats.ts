/**
 * The documents a share keeps, rendered as imitations of their real formats.
 *
 * A PDF, a photo or a Word file is not text, and a player who `cat`s one
 * should see what they would see on a real box: noise, with fragments. The
 * fragments are the point. `strings` pulls a PDF's Info dictionary and a
 * photo's Exif block out of the noise, which is how a real one gives up who
 * wrote it and when; an office file is a zip whose members are deflated, so
 * all `strings` finds there is the member names — never the author.
 *
 * Every byte the formats keep binary is drawn from characters `strings` does
 * not keep, so the readable runs are exactly the ones written on purpose. None
 * is NUL: a file `ftp get` copies is persisted to the patch store's Postgres
 * TEXT column, which rejects U+0000. None is a carriage return or an escape,
 * which a terminal would act on rather than show.
 *
 * Noise is drawn from Latin-1's letters and symbols (`¡` to `ÿ`), which is also what
 * `cat` shows of a real binary. Control characters would read the same to
 * `strings`, but JSON writes each as six characters, and the one signed write
 * that saves a file `get` fetched is capped at 8192 of them: a spreadsheet of
 * control noise could not be carried home. Every size the game states is the
 * file's length, so a character above 0x7F counting once is consistent.
 */

import { createPrng, type Prng } from './prng';

export type DocumentMetadata =
  | {
      readonly format: 'pdf';
      readonly title: string;
      readonly author: string;
      readonly createdAt: number;
      readonly modifiedAt: number;
    }
  | {
      readonly format: 'jpeg';
      readonly make: string;
      readonly model: string;
      readonly takenAt: number;
      readonly artist: string | null;
    }
  | { readonly format: 'docx' }
  | { readonly format: 'xlsx' };

/** Latin-1 from `¡` (0xA1) to `ÿ` (0xFF): above the range `strings` keeps, written
 *  by JSON as themselves, and visible. The no-break space and the soft hyphen are
 *  left out, because one reads as a space and the other as nothing. */
const NOISE_CHARACTERS: readonly string[] = Array.from({ length: 0xff - 0xa1 + 1 }, (_, index) =>
  String.fromCharCode(0xa1 + index),
).filter((character) => character !== '\u00ad');

/** Noise drawn once for the whole world. A stub takes a run of it from wherever its
 *  own stream says, which is one draw however long the run: drawing every character
 *  afresh cost more than the rest of a file server put together. */
const NOISE_BLOCK = (() => {
  const blockRng = createPrng('document-noise');
  return Array.from({ length: 4096 }, () => blockRng.pick(NOISE_CHARACTERS)).join('');
})();

const noise = (rng: Prng, length: number): string => {
  const start = rng.nextInt(0, NOISE_BLOCK.length - length);
  return NOISE_BLOCK.slice(start, start + length);
};

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const dateParts = (epochMs: number) => {
  const date = new Date(epochMs);
  return {
    year: pad(date.getUTCFullYear(), 4),
    month: pad(date.getUTCMonth() + 1, 2),
    day: pad(date.getUTCDate(), 2),
    hours: pad(date.getUTCHours(), 2),
    minutes: pad(date.getUTCMinutes(), 2),
    seconds: pad(date.getUTCSeconds(), 2),
  };
};

const pdfDate = (epochMs: number): string => {
  const { year, month, day, hours, minutes, seconds } = dateParts(epochMs);
  return `D:${year}${month}${day}${hours}${minutes}${seconds}Z`;
};

const exifDate = (epochMs: number): string => {
  const { year, month, day, hours, minutes, seconds } = dateParts(epochMs);
  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
};

/** The binary comment a real PDF writer puts on line two, so transfer tools
 *  treat the file as binary: four characters above 0x7F. */
const PDF_HEADER = '%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n';

const renderPdf = (
  metadata: Extract<DocumentMetadata, { readonly format: 'pdf' }>,
  rng: Prng,
): string => {
  const stream = noise(rng, rng.nextInt(160, 640));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n${stream}\nendstream`,
    `<< /Title (${metadata.title}) /Author (${metadata.author}) /Creator (Writer) ` +
      `/Producer (LibreOffice) /CreationDate (${pdfDate(metadata.createdAt)}) ` +
      `/ModDate (${pdfDate(metadata.modifiedAt)}) >>`,
  ];
  const { body, offsets } = objects.reduce<{ body: string; offsets: readonly number[] }>(
    (built, object, index) => ({
      body: `${built.body}${index + 1} 0 obj\n${object}\nendobj\n`,
      offsets: [...built.offsets, built.body.length],
    }),
    { body: PDF_HEADER, offsets: [] },
  );
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${pad(offset, 10)} 00000 n `),
  ].join('\n');
  return (
    `${body}${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\n` +
    `startxref\n${body.length}\n%%EOF\n`
  );
};

/** A JPEG marker: 0xFF then the marker's code, each one character. */
const marker = (code: number): string => `\u00ff${String.fromCharCode(code)}`;

const renderJpeg = (
  metadata: Extract<DocumentMetadata, { readonly format: 'jpeg' }>,
  rng: Prng,
): string => {
  const exifValues = [
    metadata.make,
    metadata.model,
    exifDate(metadata.takenAt),
    ...(metadata.artist === null ? [] : [metadata.artist]),
  ];
  return [
    marker(0xd8),
    marker(0xe0),
    noise(rng, 2),
    'JFIF',
    noise(rng, 9),
    marker(0xe1),
    noise(rng, 2),
    'Exif',
    noise(rng, 2),
    'MM',
    noise(rng, 12),
    ...exifValues.flatMap((value) => [value, noise(rng, rng.nextInt(2, 12))]),
    marker(0xdb),
    noise(rng, rng.nextInt(64, 132)),
    marker(0xc0),
    noise(rng, 17),
    marker(0xc4),
    noise(rng, rng.nextInt(28, 96)),
    marker(0xda),
    noise(rng, rng.nextInt(240, 900)),
    marker(0xd9),
  ].join('');
};

const OFFICE_MEMBERS: Readonly<Record<'docx' | 'xlsx', readonly string[]>> = {
  docx: [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'docProps/app.xml',
    'word/document.xml',
  ],
  xlsx: [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'docProps/app.xml',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
    'xl/sharedStrings.xml',
  ],
};

/** A zip: each member's local header and deflated body, then the central
 *  directory naming every member again, each name followed by its binary extra
 *  field, then the end record. `PK` is two
 *  characters, too short for `strings` to keep. */
const renderOfficeFile = (format: 'docx' | 'xlsx', rng: Prng): string => {
  const members = OFFICE_MEMBERS[format];
  const localEntries = members.map(
    (name) => `PK\u0003\u0004${noise(rng, 26)}${name}${noise(rng, rng.nextInt(48, 320))}`,
  );
  const centralEntries = members.map(
    (name) => `PK\u0001\u0002${noise(rng, 42)}${name}${noise(rng, rng.nextInt(4, 12))}`,
  );
  return [...localEntries, ...centralEntries, `PK\u0005\u0006${noise(rng, 18)}`].join('');
};

/** A document's content, its binary parts drawn from `rng`. */
export const renderDocument = (metadata: DocumentMetadata, rng: Prng): string => {
  switch (metadata.format) {
    case 'pdf':
      return renderPdf(metadata, rng);
    case 'jpeg':
      return renderJpeg(metadata, rng);
    case 'docx':
    case 'xlsx':
      return renderOfficeFile(metadata.format, rng);
  }
};
