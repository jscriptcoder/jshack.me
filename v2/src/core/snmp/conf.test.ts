import { describe, expect, it } from 'vitest';
import { SNMPD_CONF_SEED, parseSnmpdConf } from './conf';

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

  it('has no contact to give when none is configured', () => {
    expect(parseSnmpdConf('rocommunity public').sysContact).toBe('');
  });
});
