import { describe, expect, it } from 'vitest';
import {
  SNMPD_LOG_OWNER,
  SNMPD_LOG_PATH,
  SNMPD_LOG_PERMISSIONS,
  formatSnmpdArrivalLine,
  formatSnmpdAttemptLine,
  formatSnmpdSetLine,
} from './snmpdLog';
import { asGameTime } from '../types';

/**
 * `/var/log/snmpd.log` is the ONLY tell a device's owner ever gets.
 *
 * Every other door in the game costs an attacker something visible: a login, a session,
 * a shell on the box. Reconfiguring a device through its agent costs none of those — no
 * account is named, nothing is mounted, and the box keeps working. So where silence on
 * another daemon's log is a gap, silence here would mean a port table could be rewritten
 * by a stranger with nothing left behind at all.
 *
 * The lines are syslog-shaped because that is what real net-snmp emits, and they are
 * written to the DEVICE's own file because that is where an appliance running
 * `snmpd -Lf` keeps them. A router's agent noise does not belong in the file its owner
 * reads for logins.
 *
 * No line names an account, because the agent has none: the secret belongs to the
 * service. What a line can say is who tried and whether they got in.
 */

const attempt = (overrides: Partial<Parameters<typeof formatSnmpdAttemptLine>[0]> = {}) => ({
  outcome: 'failure' as const,
  user: '',
  fromIp: '10.0.0.9',
  hostname: 'gw-01',
  time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2)),
  pid: 4471,
  ...overrides,
});

describe('an snmpd.log line', () => {
  it('records a refused community string in net-snmp’s own words', () => {
    // Real net-snmp's exact wording, so a player who has seen the thing this imitates
    // reads it without being taught what it means.
    expect(formatSnmpdAttemptLine(attempt())).toBe(
      'Aug 20 09:14:02 gw-01 snmpd[4471]: ' +
        'Authentication failure (incorrect community name) from UDP: [10.0.0.9]',
    );
  });

  it('records an accepted one as plainly as it records a refusal', () => {
    // The two outcomes have to be told apart at a glance: a wall of failures followed by
    // one success is the whole shape of a sweep that landed, and it is all the defender
    // gets — the write that follows leaves no session of its own.
    expect(formatSnmpdAttemptLine(attempt({ outcome: 'success' }))).toBe(
      'Aug 20 09:14:02 gw-01 snmpd[4471]: Authentication succeeded from UDP: [10.0.0.9]',
    );
  });

  it('names the caller’s address and never an account', () => {
    const line = formatSnmpdAttemptLine(attempt({ fromIp: '203.0.113.9', user: 'root' }));

    expect(line).toContain('203.0.113.9');
    // `user` is carried by the shared attempt shape and is meaningless at this door.
    // A line naming one would be the right name against the wrong secret — which reads
    // to a player as a working credential right up until they spend it.
    expect(line).not.toContain('root');
  });

  it('stamps the device’s own name, so one file cannot answer for two boxes', () => {
    expect(formatSnmpdAttemptLine(attempt({ hostname: 'sw-14', pid: 991 }))).toContain(
      'sw-14 snmpd[991]:',
    );
  });
});

describe('an snmpd.log arrival line', () => {
  it('records that somebody reached the agent, before any community is judged', () => {
    // The arrival and the attempt are two events, and a defender needs both: a wall of
    // arrivals with no attempt behind them is a scan, while an arrival followed by a
    // refusal is somebody guessing. Collapsed into one line, those read identically.
    expect(formatSnmpdArrivalLine(attempt())).toBe(
      'Aug 20 09:14:02 gw-01 snmpd[4471]: Connection from UDP: [10.0.0.9]',
    );
  });

  it('says nothing about the outcome, which is the attempt line’s to tell', () => {
    // A reach is a reach whoever made it and whatever they then tried. An arrival that
    // varied with the outcome would state the verdict twice and could disagree with
    // itself the moment one of the two changed.
    expect(formatSnmpdArrivalLine(attempt({ outcome: 'success' }))).toBe(
      formatSnmpdArrivalLine(attempt({ outcome: 'failure' })),
    );
  });

  it('stamps the device’s own name, so one file cannot answer for two boxes', () => {
    expect(formatSnmpdArrivalLine(attempt({ hostname: 'sw-14', pid: 991 }))).toContain(
      'sw-14 snmpd[991]:',
    );
  });
});

describe('an snmpd.log SET line', () => {
  const setLine = (
    overrides: Partial<Parameters<typeof formatSnmpdSetLine>[0]> = {},
  ): ReturnType<typeof formatSnmpdSetLine> =>
    formatSnmpdSetLine({
      oid: 'forward.2222',
      previous: 'none',
      current: '192.168.188.10:22',
      fromIp: '10.0.0.9',
      hostname: 'gw-01',
      time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2)),
      pid: 4471,
      ...overrides,
    });

  it('names the OID, what the port was, what it is now, and who did it', () => {
    // The only tell there is. A walk leaves an arrival and a verdict; the WRITE that
    // follows leaves no session, no login and no shell, so if this line does not carry
    // what changed, nothing anywhere does.
    expect(setLine()).toBe(
      'Aug 20 09:14:02 gw-01 snmpd[4471]: ' +
        'SET forward.2222 = none -> 192.168.188.10:22 from UDP: [10.0.0.9]',
    );
  });

  it('records a port being closed as plainly as one being opened', () => {
    expect(setLine({ previous: '192.168.188.10:22', current: 'none' })).toContain(
      'SET forward.2222 = 192.168.188.10:22 -> none',
    );
  });

  it('records a set that changed nothing, with both values reading the same', () => {
    // Somebody holding the community touched the device, and that is the fact the
    // defender needs. A line withheld because the file did not change would hide the
    // visit that proves the community is out.
    expect(setLine({ oid: 'aclPort.8080', previous: 'deny', current: 'deny' })).toContain(
      'SET aclPort.8080 = deny -> deny from UDP: [10.0.0.9]',
    );
  });

  it('names no account, because the agent has none', () => {
    expect(setLine()).not.toContain('root');
  });
});

describe('where an snmpd.log lives', () => {
  it('is the path the device’s own agent writes, owned by root', () => {
    expect(SNMPD_LOG_PATH).toBe('/var/log/snmpd.log');
    expect(SNMPD_LOG_OWNER).toBe('root');
  });

  it('is readable by anyone on the box and writable only by root', () => {
    // World-READABLE: once you are on the box any account may read it, and getting on
    // the box is the gate. Root-only WRITE: the agent's append models a system write, so
    // a visitor can never edit away the record of their visit. Never executable.
    expect(SNMPD_LOG_PERMISSIONS).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: [],
    });
  });
});
