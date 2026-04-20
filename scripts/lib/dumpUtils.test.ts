import { describe, it, expect } from 'vitest';
import { resolvePortPatchInfo } from './dumpUtils';
import { buildTimelineFromTemplate, CVE_TIMING_CONFIG } from '../../src/generation/timeline';
import { serviceTemplates } from '../../src/generation/pools/serviceTemplates';

describe('resolvePortPatchInfo', () => {
  it('returns patchDelay and fix-released-day for a procedural version', () => {
    const timeline = buildTimelineFromTemplate(
      serviceTemplates.http,
      'timeline:http',
      500,
      CVE_TIMING_CONFIG,
    );
    const entry = timeline[3]!;
    const info = resolvePortPatchInfo('http', entry.version);
    expect(info).toEqual({
      patchDelayDays: entry.patchDelay,
      fixReleasedAtDay: entry.publishedAt + entry.patchDelay,
    });
  });

  it('returns undefined for a hand-authored (non-procedural) version', () => {
    // Apache/2.4.49 is in vulnerabilityTemplates, not the procedural timeline.
    expect(resolvePortPatchInfo('http', 'Apache/2.4.49')).toBeUndefined();
  });

  it('returns undefined for an unknown service with no template', () => {
    expect(resolvePortPatchInfo('no-such-service', 'whatever-1.0')).toBeUndefined();
  });
});
