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
    });

    const result = mail.fn('xR0gu3x@darkmail.onion', 'done') as AsyncOutput;
    const lines = runAsync(result);
    expect(completeMission).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('MISSION COMPLETE');
    expect(readFileFromMachine).toHaveBeenCalledWith(
      '10.0.0.10',
      '/opt/mysql/dumps/students.sql',
      '/',
      'root',
    );
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
    });

    expect(() => mail.fn('xR0gu3x@darkmail.onion', 'done')).toThrow('not found');
  });

  it('throws when no active mission', () => {
    const mail = createMailCommand({
      getActiveMission: () => null,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
    });

    expect(() => mail.fn('someone@darkmail.onion', 'proof')).toThrow('No active mission');
  });

  it('throws for wrong recipient', () => {
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
    });

    expect(() => mail.fn('wrong@darkmail.onion', 'proof')).toThrow('unknown recipient');
  });

  it('throws for missing arguments', () => {
    const mission = makeMission();
    const mail = createMailCommand({
      getActiveMission: () => mission,
      completeMission: vi.fn(),
      readFileFromMachine: vi.fn(),
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
});
