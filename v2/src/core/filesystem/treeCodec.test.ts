import { describe, expect, it } from 'vitest';
import type { Directory } from './types';
import { dir, file, HOME_DIR, TRAVERSABLE_DIR } from '../generation/baseFs';
import { deserializeTree, serializeTree } from './treeCodec';

/**
 * The FS tree wire codec (Story 2, slice 2c). A cross-player read is SERVER-served
 * (D1): the server materializes + filters the owner's box and ships the resulting
 * `Directory` to the reader. But a `Directory.entries` is a `Map`, and
 * `JSON.stringify(new Map())` is `{}` — every entry silently vanishes. So the tree
 * must be converted to a plain-object form before it crosses the wire and rebuilt
 * on the far side. These tests assert that round-trip, including across real JSON.
 */

const sampleTree = (): Directory =>
  dir(
    {
      'index.html': file('<h1>A</h1>', TRAVERSABLE_DIR, 'deploy'),
      bin: dir(
        {
          ls: file('#!/bin/ls', TRAVERSABLE_DIR, 'root'),
        },
        TRAVERSABLE_DIR,
      ),
      home: dir({}, HOME_DIR, 'alice'),
    },
    TRAVERSABLE_DIR,
    'root',
  );

describe('serializeTree / deserializeTree', () => {
  it('round-trips a nested tree across real JSON', () => {
    const tree = sampleTree();

    const overWire: unknown = JSON.parse(JSON.stringify(serializeTree(tree)));
    const restored = deserializeTree(overWire as ReturnType<typeof serializeTree>);

    expect(restored).toEqual(tree);
  });

  it('serializes directory entries to a plain object, not a Map (so JSON keeps them)', () => {
    const serialized = serializeTree(sampleTree());

    // The wire form must keep the discriminant so a consumer (or a different
    // deserializer) can tell directories from files at every depth.
    expect(serialized.kind).toBe('directory');
    expect(serialized.entries.bin.kind).toBe('directory');
    expect(serialized.entries).not.toBeInstanceOf(Map);
    // The whole point: a Map would stringify to "{}" and drop everything.
    expect(JSON.stringify(serialized)).toContain('index.html');
    expect(JSON.stringify(serialized)).toContain('#!/bin/ls');
  });

  it('rebuilds real Maps on deserialize, at every depth', () => {
    const restored = deserializeTree(serializeTree(sampleTree()));

    expect(restored.entries).toBeInstanceOf(Map);
    const bin = restored.entries.get('bin');
    expect(bin?.kind === 'directory' ? bin.entries : null).toBeInstanceOf(Map);
  });

  it('preserves a file’s content, owner, perms and metadata', () => {
    const tree = dir(
      {
        'ls': {
          kind: 'file',
          content: 'stub',
          owner: 'root',
          perms: TRAVERSABLE_DIR,
          metadata: { isExecutable: true, libraryLinks: ['/lib/libc.so.6'] },
        },
      },
      TRAVERSABLE_DIR,
    );

    const restored = deserializeTree(JSON.parse(JSON.stringify(serializeTree(tree))));

    const ls = restored.entries.get('ls');
    expect(ls).toEqual({
      kind: 'file',
      content: 'stub',
      owner: 'root',
      perms: TRAVERSABLE_DIR,
      metadata: { isExecutable: true, libraryLinks: ['/lib/libc.so.6'] },
    });
  });

  it('preserves a kept directory’s owner and perms', () => {
    const restored = deserializeTree(serializeTree(sampleTree()));

    const home = restored.entries.get('home');
    expect(home?.kind === 'directory' ? home.owner : null).toBe('alice');
    expect(home?.kind === 'directory' ? home.perms : null).toEqual(HOME_DIR);
  });

  it('round-trips an empty directory', () => {
    const tree = dir({ empty: dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR);

    const restored = deserializeTree(JSON.parse(JSON.stringify(serializeTree(tree))));

    const empty = restored.entries.get('empty');
    expect(empty?.kind === 'directory' ? empty.entries.size : null).toBe(0);
  });
});
