import { describe, expect, it } from 'vitest';
import {
  consumeRwCommunity,
  formatSnmpdState,
  readRwCommunityHash,
  readSnmpdState,
} from './rwCommunity';
import {
  parseSnmpdConf,
  readSnmpdConf,
  SNMPD_CONF_PERMISSIONS,
  SNMPD_CONF_SEED,
} from './conf';
import { communityTier } from '../sessions/snmpAgent';
import { md5 } from '../generation/md5';
import { applyPatches } from '../filesystem/applyPatches';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';

/**
 * `/var/lib/snmp/snmpd.conf` holds the one secret this door has: the hash of the
 * community that buys a device's port table.
 *
 * The parser is anchored at BOTH ends and lenient about everything else, in the shape
 * `rules.v4` established and `/etc/snmp/snmpd.conf` follows. Root can edit this file, so
 * a config somebody broke has to degrade into a device that answers less rather than
 * into an error nobody can act on — and a device that answers NOBODY is a real defence
 * an owner is entitled to mount by blanking it.
 *
 * The tree walk is asked of every box, not only the ones running an agent, because the
 * sweep and the walk both read it before they know what they are talking to.
 */

const HASH = 'feedfacefeedfacefeedfacefeedface';

/** A device carrying the state file, at whatever content a test needs. */
const deviceCarrying = (state: string) =>
  buildDirectory({
    var: buildDirectory({
      lib: buildDirectory({ snmp: buildDirectory({ 'snmpd.conf': buildFile(state) }) }),
    }),
  });

describe('the state file a device ships with', () => {
  it('carries the hash on its own directive, and nothing in the clear', () => {
    // Asserted against the SHIPPED seed rather than text written next to the parser: a
    // parser proved only against its own fixtures can drift from the file devices
    // actually carry, and then both halves look right while no device answers anything.
    expect(readRwCommunityHash(deviceCarrying(formatSnmpdState(HASH)))).toBe(HASH);
  });

  it('ends with a newline, the way every file an owner may append to does', () => {
    expect(formatSnmpdState(HASH).endsWith('\n')).toBe(true);
  });
});

describe('reading the community out of a state file', () => {
  it('reads the community the directive names', () => {
    expect(readRwCommunityHash(deviceCarrying(`rwcommunity ${HASH}\n`))).toBe(HASH);
  });

  it('reads a directive the owner spaced out by hand', () => {
    // Root edits this with `nano`, and a device that stopped answering because somebody
    // lined up their columns would read as broken rather than as reformatted.
    expect(readRwCommunityHash(deviceCarrying(`   rwcommunity    ${HASH}\n`))).toBe(HASH);
  });

  it('does not read a commented-out directive as a live one', () => {
    // The obvious way to disable a community without losing it. A device that went on
    // answering to a string its owner commented out would be answering to one nobody
    // can see it answering to.
    expect(readRwCommunityHash(deviceCarrying(`# rwcommunity ${HASH}\n`))).toBeUndefined();
  });

  it('refuses a directive that carries anything after the community', () => {
    // Real net-snmp allows a source restriction after a community string. This world
    // models no such restriction, and reading the community while dropping it would
    // leave a device answering everyone while its own file says otherwise. Whole line
    // or nothing, so the device falls silent and its owner has something to fix.
    expect(
      readRwCommunityHash(deviceCarrying(`rwcommunity ${HASH} 10.0.0.0/8\n`)),
    ).toBeUndefined();
  });

  it('answers to nobody when the file names no community at all', () => {
    // What blanking your own state file does, which is a defence rather than damage.
    // Reported as the absence it is, so the door closes the tier instead of falling
    // back to something nobody configured.
    expect(readRwCommunityHash(deviceCarrying('# emptied by whoever owns this box\n')))
      .toBeUndefined();
  });
});

describe('finding the state file on a device', () => {
  it('finds nothing on a box with no /var/lib at all', () => {
    // Every box is asked this, not only the ones running an agent: the sweep reads the
    // lock before it knows the door is there. A tree without the directory has to
    // answer emptily rather than throw at the first step.
    expect(readSnmpdState(buildDirectory({ etc: buildDirectory({}) }))).toBe('');
  });

  it('finds nothing on a box whose /var has no lib', () => {
    expect(readSnmpdState(buildDirectory({ var: buildDirectory({}) }))).toBe('');
  });

  it('finds nothing when /var/lib exists but holds no snmp directory', () => {
    // What a box running some OTHER stateful daemon looks like. `/var/lib` is shared
    // ground, so its presence says nothing about this agent.
    expect(readSnmpdState(buildDirectory({ var: buildDirectory({ lib: buildDirectory({}) }) }))).toBe(
      '',
    );
  });

  it('finds nothing when the agent directory is there but the file is not', () => {
    // What an owner who deleted their own state file leaves behind.
    expect(
      readSnmpdState(
        buildDirectory({ var: buildDirectory({ lib: buildDirectory({ snmp: buildDirectory({}) }) }) }),
      ),
    ).toBe('');
  });
});

/**
 * Rotating the community, which is the only way it ever changes.
 *
 * The owner writes the new string into the world-readable config and starts the agent;
 * the daemon spends the line and leaves a hash. Nothing over the wire can do this, and
 * that is the point — an OID for it would let whoever cracked the community lock the
 * real owner out of their own box.
 */
describe('spending a community the owner typed into the readable config', () => {
  const STANDING = 'the-one-already-in-force';
  const NEWLINE = String.fromCharCode(10);

  /** A box as its owner left it: an agent already answering to a community, and whatever
   *  they typed into the readable file waiting to be picked up. */
  const boxRotating = (confTail: string): Directory =>
    buildDirectory({
      var: buildDirectory({
        lib: buildDirectory({
          snmp: buildDirectory({ 'snmpd.conf': buildFile(formatSnmpdState(md5(STANDING))) }),
        }),
      }),
      etc: buildDirectory({
        snmp: buildDirectory({
          'snmpd.conf': buildFile(SNMPD_CONF_SEED + confTail, {
            perms: SNMPD_CONF_PERMISSIONS,
          }),
        }),
      }),
    });

  /** The same box once the daemon has come up and spent what it found. */
  const afterRestart = (box: Directory): Directory =>
    applyPatches(
      box,
      consumeRwCommunity(box).map((consumed) => ({
        path: asAbsPath(consumed.path),
        content: consumed.content,
        owner: 'root',
        permissions: consumed.permissions,
      })),
    );

  it('answers to the new community and refuses the one it replaced', () => {
    // The whole observable. Both halves matter: a rotation that accepted the new string
    // while still honouring the old would leave a cracked community live forever, and
    // the owner would have no way to take it out of service at all.
    const rotated = afterRestart(boxRotating('rwcommunity hunter2\n'));

    expect(communityTier(rotated, 'hunter2')).toBe('read-write');
    expect(communityTier(rotated, STANDING)).toBeNull();
  });

  it('leaves the plaintext readable by anyone on the box until the daemon spends it', () => {
    // A REAL leak window, pinned as behaviour so nobody closes it by accident. The file
    // is world-readable by design, so a visitor holding any shell can read a community
    // its owner typed and has not yet restarted into force. That is a thing to watch for
    // rather than a bug — but if it is ever closed, it should be because somebody decided
    // to, not because a refactor moved the file.
    const waiting = boxRotating('rwcommunity hunter2\n');

    expect(SNMPD_CONF_PERMISSIONS.read).toContain('guest');
    expect(readSnmpdConf(waiting)).toContain('rwcommunity hunter2');
    expect(readSnmpdState(waiting)).not.toContain('hunter2');
    expect(communityTier(waiting, 'hunter2')).toBeNull();
  });

  it('spends nothing at all when the line names no community', () => {
    // Degrades the way this file's neighbours do. A restart that consumed a blank line
    // and hashed it would leave the box answering to the empty string — a door its owner
    // closed by typo and anyone else opens by guessing nothing.
    const rotated = afterRestart(boxRotating('rwcommunity\n'));

    expect(consumeRwCommunity(boxRotating('rwcommunity\n'))).toEqual([]);
    expect(communityTier(rotated, STANDING)).toBe('read-write');
  });

  it('still answers the read-only community once the rewrite has landed', () => {
    // The rewritten file has to stay a FILE, line by line. Rebuilt as one long line the
    // anchored parsers match nothing, and a box would come back from a rotation
    // answering nobody at all — its owner having done everything right.
    const rotated = afterRestart(boxRotating('rwcommunity hunter2' + NEWLINE));

    expect(communityTier(rotated, 'public')).toBe('read-only');
    expect(parseSnmpdConf(readSnmpdConf(rotated)).sysContact).toBe('netops@corp.local');
  });

  it('spends a line its owner indented, and leaves none of it behind', () => {
    // `nano` does not stop anybody typing a space first, and the directive readers all
    // trim before matching. If the rewrite did not, the community would be taken into
    // force and the plaintext left sitting in a world-readable file — the one outcome
    // this whole rewrite exists to prevent, reached by pressing space.
    const rotated = afterRestart(boxRotating('   rwcommunity hunter2' + NEWLINE));

    expect(communityTier(rotated, 'hunter2')).toBe('read-write');
    expect(readSnmpdConf(rotated)).not.toContain('hunter2');
  });

  it('takes the first of two and still leaves neither behind', () => {
    // One community wins, the way every other directive here resolves. Both lines go
    // even so: a duplicate left in place would be the plaintext left in place, which is
    // the one thing this rewrite exists to prevent.
    const rotated = afterRestart(boxRotating('rwcommunity first\nrwcommunity second\n'));

    expect(communityTier(rotated, 'first')).toBe('read-write');
    expect(communityTier(rotated, 'second')).toBeNull();
    expect(readSnmpdConf(rotated)).not.toContain('second');
    expect(readSnmpdConf(rotated)).not.toContain('first');
  });
});
