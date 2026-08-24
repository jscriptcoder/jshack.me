import { describe, expect, it } from 'vitest';
import { parseRedisStore } from './types';

/**
 * Reading a store back is a TRUST BOUNDARY, not an internal hand-off. The file lives at
 * `/var/lib/redis/data.json` on a box a player can stand on as root, and anything a
 * player can reach they can `nano`. So the claims here are the ones the rest of the game
 * rests on: what comes back is either a store whose shape is guaranteed, or nothing —
 * and "nothing" is the same answer for every way the file can be wrong, because from the
 * daemon's side they are one condition. Telling them apart would only tell a tamperer
 * how their edit failed.
 */

const wellFormedStore = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    keys: {
      'sess:0a1b2c3d': '{"username":"devops","role":"admin"}',
      'stats:requests': '4471',
    },
    requirepassHash: '5f4dcc3b5aa765d61d8327deb882cf99',
    ...overrides,
  });

describe('reading a store back off a box', () => {
  it('returns what the box holds when the file is a store', () => {
    expect(parseRedisStore(wellFormedStore())).toEqual({
      keys: {
        'sess:0a1b2c3d': '{"username":"devops","role":"admin"}',
        'stats:requests': '4471',
      },
      requirepassHash: '5f4dcc3b5aa765d61d8327deb882cf99',
    });
  });

  it('reads an open store as a store, not as a broken one', () => {
    // Four stores in ten have no password. `null` is an ordinary state here, and a
    // schema that rejected it would make every open store unreadable.
    expect(parseRedisStore(wellFormedStore({ requirepassHash: null }))?.requirepassHash).toBe(null);
  });

  it('holds an empty store to be a store, so a player can empty one without breaking it', () => {
    expect(parseRedisStore(wellFormedStore({ keys: {} }))?.keys).toEqual({});
  });

  it('answers nothing for every way the file can be wrong', () => {
    const tampered = [
      'not json at all',
      '',
      '{"keys":',
      JSON.stringify({ keys: { 'sess:1': 42 }, requirepassHash: null }),
      JSON.stringify({ keys: {} }),
      JSON.stringify({ requirepassHash: null }),
      JSON.stringify({ keys: [], requirepassHash: null }),
      JSON.stringify({ keys: {}, requirepassHash: 7 }),
      JSON.stringify(['keys', 'requirepassHash']),
      'null',
    ];

    expect(tampered.map(parseRedisStore)).toEqual(tampered.map(() => null));
  });
});
