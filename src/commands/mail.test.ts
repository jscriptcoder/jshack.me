import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMailCommand } from './mail';
import type { MissionNetwork, MissionObjective } from '../generation/types';
import type { AsyncOutput } from '../components/Terminal/types';

const makeMission = (overrides: Partial<MissionObjective> = {}): MissionNetwork =>
  ({
    seed: 'TEST-SEED',
    difficulty: 'easy',
    clientEmail: 'xR0gu3x@darkmail.onion',
    objective: {
      type: 'exfiltrate',
      description: 'Exfiltrate data',
      targetMachine: '10.0.0.10',
      targetPath: '/srv/records/data.csv',
      targetContent: 'some,data,ACCESS-A1B2-C3D4-E5F6',
      clientEmail: 'xR0gu3x@darkmail.onion',
      expectedProof: 'ACCESS-A1B2-C3D4-E5F6',
      ...overrides,
    },
  }) as unknown as MissionNetwork;

const runAsync = (result: AsyncOutput): readonly string[] => {
  const lines: string[] = [];
  let completed = false;
  result.start(
    (line) => lines.push(line),
    () => {
      completed = true;
    },
  );
  vi.runAllTimers();
  expect(completed).toBe(true);
  return lines;
};

describe('mail command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes an exfiltrate mission with correct proof', () => {
    const completeMission = vi.fn();
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'ACCESS-A1B2-C3D4-E5F6') as AsyncOutput;
    expect(result.__type).toBe('async');

    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('shows sending progress lines', () => {
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'ACCESS-A1B2-C3D4-E5F6') as AsyncOutput;
    const lines = runAsync(result);

    expect(lines.some((l) => l.includes('darkmail.onion'))).toBe(true);
    expect(lines.some((l) => l.includes('Encrypting'))).toBe(true);
    expect(lines.some((l) => l.includes('onion network'))).toBe(true);
    expect(lines.some((l) => l.includes('delivered'))).toBe(true);
  });

  it('rejects exfiltrate mission with wrong proof', () => {
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'WRONG-KEY')).toThrow('delivery failed');
  });

  it('completes a credential_theft mission with correct password', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'credential_theft',
      expectedProof: 's3cr3tP4ss',
      targetPath: '',
      targetContent: '',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 's3cr3tP4ss') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('rejects credential_theft with wrong password', () => {
    const mission = makeMission({
      type: 'credential_theft',
      expectedProof: 's3cr3tP4ss',
      targetPath: '',
      targetContent: '',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'wrongpass')).toThrow('delivery failed');
  });

  it('completes a tamper mission when file is correctly modified', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'tamper',
      expectedProof: '',
      tamperOldValue: 'F',
      tamperNewValue: 'A',
      targetPath: '/opt/mysql/dumps/students.sql',
      targetContent: "INSERT INTO grades VALUES (2847,'Thompson','CS101','F');",
    });
    const readFileFromMachine = vi
      .fn()
      .mockReturnValue("INSERT INTO grades VALUES (2847,'Thompson','CS101','A');");
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
    expect(readFileFromMachine).toHaveBeenCalledWith({
      machineId: '10.0.0.10',
      path: '/opt/mysql/dumps/students.sql',
      cwd: '/',
      userType: 'root',
    });
  });

  it('rejects tamper mission when file still has old value', () => {
    const mission = makeMission({
      type: 'tamper',
      expectedProof: '',
      tamperOldValue: 'F',
      tamperNewValue: 'A',
      targetPath: '/opt/mysql/dumps/students.sql',
      targetContent: "INSERT INTO grades VALUES (2847,'Thompson','CS101','F');",
    });
    const readFileFromMachine = vi
      .fn()
      .mockReturnValue("INSERT INTO grades VALUES (2847,'Thompson','CS101','F');");
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('still contains');
  });

  it('rejects tamper mission when target file is missing', () => {
    const mission = makeMission({
      type: 'tamper',
      expectedProof: '',
      tamperOldValue: 'F',
      tamperNewValue: 'A',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(null);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('not found');
  });

  it('throws when no active mission', () => {
    const mail = createMailCommand({
      getActiveMission: () => null,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('someone@darkmail.onion', 'proof')).toThrow('No active mission');
  });

  it('throws for wrong recipient', () => {
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('wrong@darkmail.onion', 'proof')).toThrow('unknown recipient');
  });

  it('throws for missing arguments', () => {
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn()).toThrow('Usage');
    expect(() => mail.fn('someone@darkmail.onion')).toThrow('Usage');
  });

  it('is cancellable', () => {
    const completeMission = vi.fn();
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'ACCESS-A1B2-C3D4-E5F6') as AsyncOutput;
    expect(result.cancel).toBeDefined();

    const lines: string[] = [];
    result.start(
      (line) => lines.push(line),
      () => {},
    );

    // Cancel after first line
    vi.advanceTimersByTime(100);
    result.cancel?.();
    vi.runAllTimers();

    // Should not have completed
    expect(completeMission).not.toHaveBeenCalled();
    expect(lines.join('\n')).not.toContain('MISSION COMPLETE');
  });

  it('completes a sabotage mission when target is bricked', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'sabotage',
      expectedProof: '',
      targetPath: '',
      targetContent: '',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: (ip) => ip === '10.0.0.10',
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('rejects sabotage mission when target is not bricked', () => {
    const mission = makeMission({
      type: 'sabotage',
      expectedProof: '',
      targetPath: '',
      targetContent: '',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('still operational');
  });

  it('completes a backdoor mission when PID file exists with correct user', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'backdoor',
      expectedProof: '',
      targetPath: '',
      targetContent: '',
      backdoorPort: 4444,
      backdoorUser: 'root',
    });
    const readFileFromMachine = vi
      .fn()
      .mockReturnValue('nc:port=4444,user=root,userType=root,home=/root');
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
    expect(readFileFromMachine).toHaveBeenCalledWith({
      machineId: '10.0.0.10',
      path: '/var/run/nc-4444.pid',
      cwd: '/',
      userType: 'root',
    });
  });

  it('rejects backdoor mission when PID file is missing', () => {
    const mission = makeMission({
      type: 'backdoor',
      expectedProof: '',
      targetPath: '',
      targetContent: '',
      backdoorPort: 4444,
      backdoorUser: 'root',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(null);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('No listener');
  });

  it('rejects backdoor mission when opened as wrong user', () => {
    const mission = makeMission({
      type: 'backdoor',
      expectedProof: '',
      targetPath: '',
      targetContent: '',
      backdoorPort: 4444,
      backdoorUser: 'root',
    });
    const readFileFromMachine = vi
      .fn()
      .mockReturnValue('nc:port=4444,user=guest,userType=guest,home=/home/guest');
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('must be opened as root');
  });

  it('completes a portforward mission when iptables rule matches', () => {
    const completeMission = vi.fn();
    const mission = {
      ...makeMission({
        type: 'portforward',
        expectedProof: '',
        targetPath: '',
        targetContent: '',
        forwardPublicPort: 8080,
        forwardInternalIp: '10.0.0.10',
        forwardInternalPort: 22,
      }),
      routerPublicIp: '198.51.100.1',
    } as unknown as MissionNetwork;
    const iptablesContent =
      '# Port Forwarding Rules\n# forward <public_port> to <internal_ip>:<port>\nforward 8080 to 10.0.0.10:22';
    const readFileFromMachine = vi.fn().mockReturnValue(iptablesContent);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
    expect(readFileFromMachine).toHaveBeenCalledWith({
      machineId: '198.51.100.1',
      path: '/etc/iptables/rules.v4',
      cwd: '/',
      userType: 'root',
    });
  });

  it('rejects portforward mission when no matching rule', () => {
    const mission = {
      ...makeMission({
        type: 'portforward',
        expectedProof: '',
        targetPath: '',
        targetContent: '',
        forwardPublicPort: 8080,
        forwardInternalIp: '10.0.0.10',
        forwardInternalPort: 22,
      }),
      routerPublicIp: '198.51.100.1',
    } as unknown as MissionNetwork;
    const iptablesContent = '# Port Forwarding Rules\nforward 9999 to 10.0.0.99:80';
    const readFileFromMachine = vi.fn().mockReturnValue(iptablesContent);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('No matching forwarding rule');
  });

  it('rejects portforward mission when iptables file is missing', () => {
    const mission = {
      ...makeMission({
        type: 'portforward',
        expectedProof: '',
        targetPath: '',
        targetContent: '',
        forwardPublicPort: 8080,
        forwardInternalIp: '10.0.0.10',
        forwardInternalPort: 22,
      }),
      routerPublicIp: '198.51.100.1',
    } as unknown as MissionNetwork;
    const readFileFromMachine = vi.fn().mockReturnValue(null);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('Cannot read iptables rules');
  });

  it('completes a forensics mission with handle:ip proof', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'forensics',
      attackerHandle: 'xR0gu3x',
      attackerIp: '45.33.12.99',
      expectedProof: 'xR0gu3x:45.33.12.99',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'xR0gu3x:45.33.12.99') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('accepts forensics proof with various separators', () => {
    const separators = [':', ', ', ' ', ' - ', ','];
    for (const sep of separators) {
      const completeMission = vi.fn();
      const mission = makeMission({
        type: 'forensics',
        attackerHandle: 'gh0st_',
        attackerIp: '91.200.12.55',
        expectedProof: 'gh0st_:91.200.12.55',
      });
      const mail = createMailCommand({
        getActiveMission: () => mission,
        completeMission,
        readFileFromMachine: vi.fn(),
        isMachineBricked: () => false,
      });

      const proof = `gh0st_${sep}91.200.12.55`;
      const result = mail.fn('xR0gu3x@darkmail.onion', proof) as AsyncOutput;
      runAsync(result);
      expect(completeMission).toHaveBeenCalledTimes(1);
    }
  });

  it('accepts forensics proof in reverse order (ip first)', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'forensics',
      attackerHandle: 'ph4nt0m',
      attackerIp: '162.44.88.12',
      expectedProof: 'ph4nt0m:162.44.88.12',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', '162.44.88.12:ph4nt0m') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('rejects forensics proof with wrong handle', () => {
    const mission = makeMission({
      type: 'forensics',
      attackerHandle: 'xR0gu3x',
      attackerIp: '45.33.12.99',
      expectedProof: 'xR0gu3x:45.33.12.99',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'wrong:45.33.12.99')).toThrow('delivery failed');
  });

  it('rejects forensics proof with missing part', () => {
    const mission = makeMission({
      type: 'forensics',
      attackerHandle: 'xR0gu3x',
      attackerIp: '45.33.12.99',
      expectedProof: 'xR0gu3x:45.33.12.99',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'xR0gu3x')).toThrow('delivery failed');
  });

  it('completes a script_fix mission when script calls _system with correct value', () => {
    const completeMission = vi.fn();
    const fixedScript = [
      'const backups = ["db_full", "db_diff", "logs", "config"]',
      'const critical = backups.filter(b => b.startsWith("db"))',
      'if (critical.length === 2) {',
      '  _system(critical.join("-"))',
      '} else {',
      '  echo("ERROR: backup validation failed")',
      '}',
    ].join('\n');
    const mission = makeMission({
      type: 'script_fix',
      expectedProof: '',
      expectedChecksum: 'db_full-db_diff',
      targetPath: '/srv/scripts/validate_backups.js',
      targetContent: fixedScript,
      scriptBugType: 'syntax',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(fixedScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('completes a script_fix mission when called without content', () => {
    const completeMission = vi.fn();
    const fixedScript = '_system("ok")';
    const mission = makeMission({
      type: 'script_fix',
      expectedProof: '',
      expectedChecksum: 'ok',
      targetPath: '/srv/scripts/test.js',
      targetContent: fixedScript,
    });
    const readFileFromMachine = vi.fn().mockReturnValue(fixedScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('rejects script_fix when script output is wrong', () => {
    const brokenScript = '_system("wrong-value")';
    const mission = makeMission({
      type: 'script_fix',
      expectedProof: '',
      expectedChecksum: 'correct-value',
      targetPath: '/srv/scripts/test.js',
      targetContent: brokenScript,
    });
    const readFileFromMachine = vi.fn().mockReturnValue(brokenScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('Script output is incorrect');
  });

  it('rejects script_fix when script does not call _system', () => {
    const brokenScript = 'echo("hello")';
    const mission = makeMission({
      type: 'script_fix',
      expectedProof: '',
      expectedChecksum: 'expected',
      targetPath: '/srv/scripts/test.js',
      targetContent: brokenScript,
    });
    const readFileFromMachine = vi.fn().mockReturnValue(brokenScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('did not call _system');
  });

  it('rejects script_fix when script file is missing', () => {
    const mission = makeMission({
      type: 'script_fix',
      expectedProof: '',
      expectedChecksum: 'expected',
      targetPath: '/srv/scripts/test.js',
      targetContent: '',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(null);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('Script not found');
  });

  it('rejects script_fix when script has syntax error', () => {
    const brokenScript = 'function(';
    const mission = makeMission({
      type: 'script_fix',
      expectedProof: '',
      expectedChecksum: 'expected',
      targetPath: '/srv/scripts/test.js',
      targetContent: brokenScript,
    });
    const readFileFromMachine = vi.fn().mockReturnValue(brokenScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('Script execution failed');
  });

  it('completes a script_auto local mission when script calls _system with correct value', () => {
    const completeMission = vi.fn();
    const dataContent = JSON.stringify({ checksum: 'f7a3c9b1e2d4', status: 'complete' });
    const playerScript = [
      'const data = JSON.parse(cat("/var/lib/backup/status.json"))',
      '_system(data.checksum)',
    ].join('\n');
    const mission = makeMission({
      type: 'script_auto',
      expectedProof: '',
      targetPath: '/etc/cron.d/backup-verify.js',
      targetContent: playerScript,
      expectedChecksum: 'f7a3c9b1e2d4',
      scriptAutoFlavor: 'local',
      scriptAutoDataPath: '/var/lib/backup/status.json',
      scriptAutoDataContent: dataContent,
    });
    const readFileFromMachine = vi.fn((op: { path: string }) => {
      if (op.path === '/etc/cron.d/backup-verify.js') return playerScript;
      if (op.path === '/var/lib/backup/status.json') return dataContent;
      return null;
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('completes a script_auto remote mission when script calls _system with correct value', () => {
    const completeMission = vi.fn();
    const dataContent = JSON.stringify({ array_key: 'raid-6c2a9f4b1e' });
    const playerScript = [
      'const resp = await curl("http://10.0.0.5/api/raid-status", "-X", "POST")',
      'const data = JSON.parse(resp[0])',
      '_system(data.array_key)',
    ].join('\n');
    const mission = makeMission({
      type: 'script_auto',
      expectedProof: '',
      targetPath: '/etc/init.d/raid-check.js',
      targetContent: playerScript,
      expectedChecksum: 'raid-6c2a9f4b1e',
      scriptAutoFlavor: 'remote',
      scriptAutoDataContent: dataContent,
      scriptAutoApiMachine: '10.0.0.5',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(playerScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
  });

  it('rejects script_auto mission when script output is wrong', () => {
    const playerScript = '_system("wrong-value")';
    const mission = makeMission({
      type: 'script_auto',
      expectedProof: '',
      targetPath: '/etc/cron.d/test.js',
      targetContent: playerScript,
      expectedChecksum: 'correct-value',
      scriptAutoFlavor: 'local',
      scriptAutoDataPath: '/var/data.json',
      scriptAutoDataContent: '{}',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(playerScript);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('Script output is incorrect');
  });

  it('rejects script_auto when script file is missing', () => {
    const mission = makeMission({
      type: 'script_auto',
      expectedProof: '',
      targetPath: '/etc/cron.d/test.js',
      targetContent: '',
      expectedChecksum: 'expected',
      scriptAutoFlavor: 'local',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(null);
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('Script not found');
  });

  it('completes malware mission when both malware file and PID file are deleted', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'malware',
      expectedProof: '',
      targetPath: '/etc/cron.d/cache-warmer.js',
      targetContent: 'malware content',
      malwarePidPath: '/var/run/cache-warmer.pid',
      malwarePidName: 'cache-warmer.pid',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(null); // both files deleted
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.some((l) => l.includes('MISSION COMPLETE'))).toBe(true);
  });

  it('rejects malware mission when malware file still exists', () => {
    const mission = makeMission({
      type: 'malware',
      expectedProof: '',
      targetPath: '/etc/cron.d/cache-warmer.js',
      targetContent: 'malware content',
      malwarePidPath: '/var/run/cache-warmer.pid',
      malwarePidName: 'cache-warmer.pid',
    });
    const readFileFromMachine = vi.fn((op) =>
      op.path === '/etc/cron.d/cache-warmer.js' ? 'malware content' : null,
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('still on disk');
  });

  it('rejects malware mission when PID file still exists', () => {
    const mission = makeMission({
      type: 'malware',
      expectedProof: '',
      targetPath: '/etc/cron.d/cache-warmer.js',
      targetContent: 'malware content',
      malwarePidPath: '/var/run/cache-warmer.pid',
      malwarePidName: 'cache-warmer.pid',
    });
    const readFileFromMachine = vi.fn((op) =>
      op.path === '/var/run/cache-warmer.pid' ? '/etc/cron.d/cache-warmer.js:port=1' : null,
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('still running');
  });
});

describe('MySQL objective verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dbJson = (tables: Record<string, unknown>) => JSON.stringify({ name: 'app_prod', tables });

  it('completes db_exfiltrate with correct ACCESS-KEY', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'db_exfiltrate',
      expectedProof: 'ACCESS-1234-5678-9012',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'ACCESS-1234-5678-9012') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('fails db_exfiltrate with wrong proof', () => {
    const mission = makeMission({
      type: 'db_exfiltrate',
      expectedProof: 'ACCESS-1234-5678-9012',
    });
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'WRONG')).toThrow('Incorrect proof');
  });

  it('completes db_tamper when value was changed', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'db_tamper',
      dbTargetTable: 'users',
      dbTamperColumn: 'role',
      dbTamperOldValue: 'admin',
      dbTamperNewValue: 'user',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(
      dbJson({
        users: {
          columns: [{ name: 'role', type: 'VARCHAR', nullable: true }],
          rows: [{ id: 1, username: 'admin', role: 'user' }],
        },
      }),
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('fails db_tamper when old value still present', () => {
    const mission = makeMission({
      type: 'db_tamper',
      dbTargetTable: 'users',
      dbTamperColumn: 'role',
      dbTamperOldValue: 'admin',
      dbTamperNewValue: 'user',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(
      dbJson({
        users: {
          columns: [],
          rows: [{ id: 1, username: 'admin', role: 'admin' }],
        },
      }),
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('still present');
  });

  it('completes db_fix when corrupted value was restored', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'db_fix',
      dbTargetTable: 'config',
      dbTamperColumn: 'value',
      dbTamperOldValue: 'true',
      dbTamperNewValue: 'false',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(
      dbJson({
        config: {
          columns: [],
          rows: [{ id: 1, key: 'maintenance_mode', value: 'false' }],
        },
      }),
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('completes db_sabotage when table was dropped', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'db_sabotage',
      dbTargetTable: 'sessions',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(
      dbJson({
        users: { columns: [], rows: [{ id: 1 }] },
        // sessions table is missing — dropped
      }),
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('completes db_sabotage when all rows deleted', () => {
    const completeMission = vi.fn();
    const mission = makeMission({
      type: 'db_sabotage',
      dbTargetTable: 'sessions',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(
      dbJson({
        sessions: { columns: [], rows: [] },
      }),
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission,
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    runAsync(result);
    expect(completeMission).toHaveBeenCalled();
  });

  it('fails db_sabotage when table still has data', () => {
    const mission = makeMission({
      type: 'db_sabotage',
      dbTargetTable: 'sessions',
    });
    const readFileFromMachine = vi.fn().mockReturnValue(
      dbJson({
        sessions: { columns: [], rows: [{ id: 1, token: 'abc' }] },
      }),
    );
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine,
      isMachineBricked: () => false,
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('still has data');
  });
});
