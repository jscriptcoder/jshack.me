import { describe, expect, it } from 'vitest';
import { missionFileContent, missionFileName, missionFilePath } from './missionFileItem.js';

/** A spread of contract numbers. */
const SAMPLE_NUMBERS = Array.from({ length: 400 }, (_unused, index) => index * 8381 + 2);

const SECRET = 'test-mission-secret';

/** What `strings` keeps: runs of four or more printable ASCII characters. */
const readableRuns = (content: string): readonly string[] => content.match(/[ -~]{4,}/g) ?? [];

describe("a file job's firmware image", () => {
  it('is named for a device and a version, as a firmware build is', () => {
    const names = SAMPLE_NUMBERS.map(missionFileName);

    for (const name of names) expect(name).toMatch(/^[a-z]{3}-fw-\d\.\d\.\d{1,2}\.bin$/);
    expect(new Set(names.map((name) => name.slice(0, 3)))).toEqual(
      new Set(['ctl', 'plc', 'rtu', 'hmi', 'cam']),
    );
    expect(new Set(names).size).toBeGreaterThan(SAMPLE_NUMBERS.length / 2);
  });

  it('sits in /opt/firmware or /srv/releases, under its own name', () => {
    const directories = SAMPLE_NUMBERS.map((missionNumber) => {
      const path = missionFilePath(missionNumber);
      expect(path.endsWith(`/${missionFileName(missionNumber)}`)).toBe(true);
      return path.slice(0, path.lastIndexOf('/'));
    });

    expect(new Set(directories)).toEqual(new Set(['/opt/firmware', '/srv/releases']));
  });

  it('is the same name and place for the same number', () => {
    expect(missionFilePath(66051)).toBe(missionFilePath(66051));
  });

  it('opens with a header naming its version and device, the one run `strings` finds', () => {
    for (const missionNumber of SAMPLE_NUMBERS.slice(0, 50)) {
      const name = missionFileName(missionNumber);
      const [device, , version] = name.replace(/\.bin$/, '').split('-');

      expect(readableRuns(missionFileContent(missionNumber, SECRET))).toEqual([
        `FWIMG v${version} ${device}`,
      ]);
    }
  });

  it('runs 1,000 to 3,000 characters of noise past its header, varying from job to job', () => {
    const lengths = SAMPLE_NUMBERS.map((missionNumber) => {
      const content = missionFileContent(missionNumber, SECRET);
      return content.length - readableRuns(content)[0]!.length;
    });

    for (const length of lengths) {
      expect(length).toBeGreaterThanOrEqual(1000);
      expect(length).toBeLessThanOrEqual(3000);
    }
    expect(Math.min(...lengths)).toBeLessThan(1200);
    expect(Math.max(...lengths)).toBeGreaterThan(2800);
  });

  // A copy goes through a signed write and a TEXT column, which refuse NUL and would cost
  // control characters six times their size; a soft hyphen reads as nothing.
  it('is noise of Latin-1 letters and symbols only, so a copy carries it unchanged', () => {
    for (const missionNumber of SAMPLE_NUMBERS.slice(0, 50)) {
      const content = missionFileContent(missionNumber, SECRET);
      const noise = content.slice(readableRuns(content)[0]!.length);

      expect(noise).toMatch(/^[\u00a1-\u00ac\u00ae-\u00ff]+$/);
      expect(new Set(noise).size).toBeGreaterThan(80);
    }
  });

  it('draws its noise from the whole of that range, from ¡ up to ÿ', () => {
    const drawn = new Set(
      SAMPLE_NUMBERS.slice(0, 20).flatMap((missionNumber) => {
        const content = missionFileContent(missionNumber, SECRET);
        return [...content.slice(readableRuns(content)[0]!.length)];
      }),
    );

    expect(drawn.size).toBe(0xff - 0xa1);
    expect(drawn.has('¡')).toBe(true);
    expect(drawn.has('ÿ')).toBe(true);
  });

  it('is the same file for the same number under the same secret', () => {
    expect(missionFileContent(66051, SECRET)).toBe(missionFileContent(66051, SECRET));
  });

  // Nobody can make the file from the bundle: without the secret it cannot be drawn.
  it('is another file under another secret, and for another number', () => {
    const laid = missionFileContent(66051, SECRET);

    expect(missionFileContent(66051, 'another-secret')).not.toBe(laid);
    expect(missionFileContent(66052, SECRET)).not.toBe(laid);
  });
});
