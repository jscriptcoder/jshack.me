import { describe, it, expect } from 'vitest';
import {
  bumpTuple,
  buildTimeline,
  buildTimelineFromTemplate,
  findLatestSafeVersion,
  findGeneratedVersion,
} from './walker';
import { CVE_TIMING_CONFIG } from './config';
import type { VersionTemplate } from '../pools/serviceTemplates';

const TIMING = CVE_TIMING_CONFIG;

describe('bumpTuple', () => {
  it('patch bump increments the last element only', () => {
    expect(bumpTuple([2, 4, 60], 'patch')).toEqual([2, 4, 61]);
    expect(bumpTuple([2, 4, 99], 'patch')).toEqual([2, 4, 100]);
  });

  it('minor bump increments the middle element and resets patch to 0', () => {
    expect(bumpTuple([2, 4, 60], 'minor')).toEqual([2, 5, 0]);
    expect(bumpTuple([2, 4, 99], 'minor')).toEqual([2, 5, 0]);
  });

  it('major bump increments the first element and resets minor + patch', () => {
    expect(bumpTuple([2, 4, 60], 'major')).toEqual([3, 0, 0]);
    expect(bumpTuple([9, 99, 99], 'major')).toEqual([10, 0, 0]);
  });

  it('does not mutate the input tuple', () => {
    const input = [2, 4, 60];
    bumpTuple(input, 'patch');
    expect(input).toEqual([2, 4, 60]);
  });

  it('handles 2-element tuples (minor bumps the second element)', () => {
    expect(bumpTuple([7, 2], 'patch')).toEqual([7, 3]);
    expect(bumpTuple([7, 2], 'minor')).toEqual([7, 3]);
    expect(bumpTuple([7, 2], 'major')).toEqual([8, 0]);
  });
});

describe('buildTimeline', () => {
  it('produces an empty timeline for services with no template', () => {
    const timeline = buildTimeline('no-such-service', 1000, TIMING);
    expect(timeline).toEqual([]);
  });

  it('is deterministic for the same service', () => {
    const a = buildTimeline('http', 100, TIMING);
    const b = buildTimeline('http', 100, TIMING);
    expect(a).toEqual(b);
  });

  it('produces different timelines for different services', () => {
    const http = buildTimeline('http', 100, TIMING);
    const mysql = buildTimeline('mysql', 100, TIMING);
    expect(http[0]?.version).not.toBe(mysql[0]?.version);
  });

  it('seeds each service with its own prng (publishedAts differ across services)', () => {
    // Pins that the service name is part of the PRNG key. If the walker
    // shared one seed across services, every service would have identical
    // publishedAt sequences.
    const http = buildTimeline('http', 500, TIMING);
    const mysql = buildTimeline('mysql', 500, TIMING);
    const httpTimes = http.map((e) => e.publishedAt);
    const mysqlTimes = mysql.map((e) => e.publishedAt);
    expect(httpTimes).not.toEqual(mysqlTimes);
  });

  it('first entry uses the service template starting tuple', () => {
    const timeline = buildTimeline('http', 100, TIMING);
    const first = timeline[0];
    expect(first).toBeDefined();
    expect(first?.version).toBe('Apache/2.4.60');
  });

  it('publishedAt values are strictly monotonically increasing', () => {
    const timeline = buildTimeline('http', 500, TIMING);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.publishedAt).toBeGreaterThan(timeline[i - 1]!.publishedAt);
    }
  });

  it('each gap falls within [minSafeWindowDays, maxSafeWindowDays]', () => {
    const timeline = buildTimeline('http', 500, TIMING);
    for (let i = 1; i < timeline.length; i++) {
      const gap = timeline[i]!.publishedAt - timeline[i - 1]!.publishedAt;
      expect(gap).toBeGreaterThanOrEqual(TIMING.minSafeWindowDays);
      expect(gap).toBeLessThanOrEqual(TIMING.maxSafeWindowDays);
    }
  });

  it('walks at least past the requested publishedAt', () => {
    const target = 200;
    const timeline = buildTimeline('http', target, TIMING);
    const last = timeline[timeline.length - 1];
    expect(last?.publishedAt).toBeGreaterThan(target);
  });

  it('walks past the target when target exactly equals an existing publishedAt', () => {
    // Edge case: the loop stop condition must include equality, otherwise
    // when gameTime lands exactly on a boundary the timeline truncates one
    // step early and findLatestSafeVersion can't find a "next" version.
    const reference = buildTimeline('http', 500, TIMING);
    const boundary = reference[3]!.publishedAt;
    const timeline = buildTimeline('http', boundary, TIMING);
    const last = timeline[timeline.length - 1];
    expect(last!.publishedAt).toBeGreaterThan(boundary);
  });

  it('index values are sequential from 0', () => {
    const timeline = buildTimeline('http', 200, TIMING);
    timeline.forEach((entry, i) => expect(entry.index).toBe(i));
  });
});

describe('buildTimelineFromTemplate', () => {
  const template: VersionTemplate = {
    prefix: 'TestVendor/',
    separator: '.',
    startTuple: [1, 0, 0],
  };

  it('walks a procedural timeline for any given template (not just serviceTemplates)', () => {
    const timeline = buildTimelineFromTemplate(template, 'test:vendor-a', 200, TIMING);
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]!.version).toBe('TestVendor/1.0.0');
    expect(timeline[0]!.publishedAt).toBeGreaterThan(0);
  });

  it('uses the prng key to seed the walk (different keys → different timelines)', () => {
    const a = buildTimelineFromTemplate(template, 'test:key-a', 500, TIMING);
    const b = buildTimelineFromTemplate(template, 'test:key-b', 500, TIMING);
    expect(a).not.toEqual(b);
  });

  it('is deterministic for the same template and prng key', () => {
    const a = buildTimelineFromTemplate(template, 'test:stable', 300, TIMING);
    const b = buildTimelineFromTemplate(template, 'test:stable', 300, TIMING);
    expect(a).toEqual(b);
  });
});

describe('findLatestSafeVersion', () => {
  it('skips the entry whose publishedAt exactly equals gameTime', () => {
    // At the boundary, that entry's CVE is published *right now* — it's
    // no longer safe. The returned version must be a strictly later one.
    const timeline = buildTimeline('http', 500, TIMING);
    const boundary = timeline[3]!;
    const safe = findLatestSafeVersion('http', boundary.publishedAt, TIMING);
    expect(safe).toBeDefined();
    expect(safe).not.toBe(boundary.version);
    const safeEntry = timeline.find((e) => e.version === safe);
    expect(safeEntry!.publishedAt).toBeGreaterThan(boundary.publishedAt);
  });

  it('returns undefined for services with no template', () => {
    expect(findLatestSafeVersion('no-such-service', 0, TIMING)).toBeUndefined();
  });
});

describe('findGeneratedVersion', () => {
  it('finds a version that exists in the generator walk', () => {
    const timeline = buildTimeline('http', 200, TIMING);
    const someEntry = timeline[Math.floor(timeline.length / 2)];
    expect(someEntry).toBeDefined();

    const found = findGeneratedVersion('http', someEntry!.version, 200, TIMING);
    expect(found?.version).toBe(someEntry!.version);
    expect(found?.index).toBe(someEntry!.index);
  });

  it('returns undefined for a version that never appears', () => {
    const found = findGeneratedVersion('http', 'Apache/999.999.999', 100, TIMING);
    expect(found).toBeUndefined();
  });

  it('returns undefined for services with no template', () => {
    const found = findGeneratedVersion('no-such-service', 'anything', 100, TIMING);
    expect(found).toBeUndefined();
  });
});
