import { describe, expect, it, vi } from 'vitest';
import {
  appendMachineLog,
  appendMachineLogLines,
  type AppendLog,
  type MachineLogTarget,
} from './appendMachineLog.js';
import type { AbsPath } from '../types.js';

const LOG_KEY = 'ap:TYRELL-CORP';
const MACHINE = 'gateway-machine';
const AUTH_LOG = '/var/log/auth.log';

const target = (over: Partial<MachineLogTarget> = {}): MachineLogTarget => ({
  writerKey: LOG_KEY,
  machineId: MACHINE,
  path: AUTH_LOG as AbsPath,
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: [] },
  ...over,
});

/** An append that lands. Where it lands among the lines already there is the
 *  database's to decide, so the tests read what was SENT. */
const accepting = () => vi.fn<AppendLog>(async () => ({ error: null }));

const sentText = (appendLog: ReturnType<typeof accepting>) =>
  appendLog.mock.calls.map(([append]) => append.text);

const NEW_LINE = 'Oct  4 11:00:00 gw sshd[2]: Failed password for root from 193.4.5.6';

describe('appendMachineLog', () => {
  it('asks for the line on the target log, written as the target writer with its owner and mode', async () => {
    const appendLog = accepting();

    await appendMachineLog({ appendLog }, target(), NEW_LINE);

    expect(appendLog).toHaveBeenCalledWith({
      machine_id: MACHINE,
      path: AUTH_LOG,
      writer_key: LOG_KEY,
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      text: `${NEW_LINE}\n`,
    });
  });

  // Most of a line is what the caller sent: a path, an account, a package name. A break
  // inside one would end the line early and start another that the caller wrote whole.
  it.each([
    ['a line feed', 'GET /a\nGET /b', 'GET /a\\nGET /b'],
    ['a carriage return', 'GET /a\rGET /b', 'GET /a\\rGET /b'],
    ['every break of several', 'GET /a\r\nGET /b\nGET /c\rGET /d', 'GET /a\\r\\nGET /b\\nGET /c\\rGET /d'],
  ])('writes %s inside the line as text, so it stays one line', async (_, line, written) => {
    const appendLog = accepting();

    await appendMachineLog({ appendLog }, target(), line);

    expect(sentText(appendLog)).toEqual([`${written}\n`]);
  });

  describe('several lines at once', () => {
    const ARRIVAL = 'Oct  4 11:00:00 gw vsftpd[2]: CONNECT: Client "193.4.5.6"';

    it('sends them in one append, each on its own line', async () => {
      const appendLog = accepting();

      await appendMachineLogLines({ appendLog }, target(), [ARRIVAL, NEW_LINE]);

      expect(sentText(appendLog)).toEqual([`${ARRIVAL}\n${NEW_LINE}\n`]);
    });

    it('keeps a break inside any one of them from adding a line between the others', async () => {
      const appendLog = accepting();

      await appendMachineLogLines({ appendLog }, target(), [ARRIVAL, 'GET /a\nGET /b', NEW_LINE]);

      expect(sentText(appendLog)).toEqual([`${ARRIVAL}\nGET /a\\nGET /b\n${NEW_LINE}\n`]);
    });
  });

  it('says nothing when the append fails, so the action it records goes on', async () => {
    const appendLog = vi.fn<AppendLog>(async () => ({ error: new Error('append failed') }));

    await expect(appendMachineLog({ appendLog }, target(), NEW_LINE)).resolves.toBeUndefined();
  });
});
