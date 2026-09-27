import { describe, expect, it } from 'vitest';
import { SNMPD_CONF_SEED, parseSnmpdConf, readSnmpdConf } from './conf';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';

/**
 * `/etc/snmp/snmpd.conf` carries the two identity facts nothing else in the world
 * knows: which community string the agent answers to, and who to shout at about the
 * device. Everything else a walk returns — the name, the platform, the addresses — is
 * derived from what the world already holds, so this file is deliberately small.
 *
 * It is WORLD-READABLE, and that is not a leak. The read-only community being `public`
 * is the actual joke of real SNMP: the string is not a secret and never was. The one
 * that IS a secret lives somewhere root-only, and this file never names it.
 *
 * Parsing is lenient in the shape `rules.v4` established — comments, blank lines and
 * directives the game does not model are skipped rather than failing the file — because
 * the owner can edit this with `nano` and a config a player broke should degrade, not
 * explode.
 */

describe('the snmpd.conf a device ships with', () => {
  it('answers to the read-only community every agent answers to', () => {
    // Asserted against the SHIPPED seed rather than a fixture: a parser proved only
    // against text written next to it can drift from the file devices actually carry,
    // and then both halves look correct while no device answers anything.
    expect(parseSnmpdConf(SNMPD_CONF_SEED)).toEqual({
      roCommunity: 'public',
      sysContact: 'netops@corp.local',
    });
  });
});

describe('reading an snmpd.conf', () => {
  it('skips comments, blank lines and directives the game does not model', () => {
    expect(
      parseSnmpdConf(
        [
          '# /etc/snmp/snmpd.conf — SNMP agent configuration',
          '',
          'agentaddress udp:161',
          'rocommunity public',
          '   ',
          'sysservices 79',
          'syscontact netops@corp.local',
        ].join('\n'),
      ),
    ).toEqual({ roCommunity: 'public', sysContact: 'netops@corp.local' });
  });

  it('keeps a contact that contains spaces whole', () => {
    // `syscontact` is free text on a real agent, and a device whose contact was
    // truncated at the first space would name a person who does not exist.
    expect(parseSnmpdConf('syscontact Net Ops <netops@corp.local>').sysContact).toBe(
      'Net Ops <netops@corp.local>',
    );
  });

  it('answers to nobody when no community is named', () => {
    // An agent with no `rocommunity` accepts no string at all, which is what an owner
    // who blanked this file has done to their own device. Reported as the absence it
    // is, so the door can refuse rather than fall back to a default nobody configured.
    expect(parseSnmpdConf('# nothing here').roCommunity).toBeNull();
  });

  it('does not read a commented-out directive as a live one', () => {
    // The obvious way to disable a community without losing it is to put a # in front,
    // and a device that went on answering to a string its owner commented out would be
    // answering to one nobody can see it answering to.
    expect(
      parseSnmpdConf(['# rocommunity public', '#syscontact netops@corp.local'].join('\n')),
    ).toEqual({ roCommunity: null, sysContact: '' });
  });

  it('does not understand a community that carries a source restriction', () => {
    // Real net-snmp reads `rocommunity public 10.0.0.0/8` as "answer public, but only
    // to that subnet". This world models no such restriction, and reading the community
    // while dropping the restriction would leave a device answering everyone while its
    // own config says otherwise — a lie its owner can read in their own file. Refused
    // whole instead: the device goes quiet, which is a thing the owner can see and fix.
    expect(parseSnmpdConf('rocommunity public 10.0.0.0/8').roCommunity).toBeNull();
  });

  it('has no contact to give when none is configured', () => {
    expect(parseSnmpdConf('rocommunity public').sysContact).toBe('');
  });

  it('reads a directive the owner indented or spaced out by hand', () => {
    // This file is edited with `nano` by whoever owns the box, and a config that
    // stopped answering because somebody lined up their columns would read as a broken
    // device rather than as a formatting opinion.
    expect(
      parseSnmpdConf(['   rocommunity  corpnet', '\tsyscontact  netops@corp.local'].join('\n')),
    ).toEqual({ roCommunity: 'corpnet', sysContact: 'netops@corp.local' });
  });
});

describe('finding the conf on a device', () => {
  const deviceCarrying = (conf: string) =>
    buildDirectory({ etc: buildDirectory({ snmp: buildDirectory({ 'snmpd.conf': buildFile(conf) }) }) });

  it('reads the file the device carries', () => {
    expect(readSnmpdConf(deviceCarrying('rocommunity corpnet'))).toBe('rocommunity corpnet');
  });

  it('finds nothing on a box that has no /etc at all', () => {
    // Every box in the world is asked this, not only the ones that run an agent: the
    // walk reads the conf before it knows what it is talking to. A tree without the
    // directory has to answer emptily rather than throw at the first step.
    expect(readSnmpdConf(buildDirectory({ var: buildDirectory({}) }))).toBe('');
  });

  it('finds nothing when the agent directory is there but the file is not', () => {
    // What an owner who deleted their own conf leaves behind. The device then answers
    // to no community at all, which is the point of being able to delete it.
    expect(readSnmpdConf(buildDirectory({ etc: buildDirectory({ snmp: buildDirectory({}) }) }))).toBe(
      '',
    );
  });
});
