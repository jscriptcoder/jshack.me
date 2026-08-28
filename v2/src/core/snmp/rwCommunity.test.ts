import { describe, expect, it } from 'vitest';
import { formatSnmpdState, readRwCommunityHash, readSnmpdState } from './rwCommunity';
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
