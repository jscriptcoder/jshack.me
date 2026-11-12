import { describe, expect, it } from 'vitest';
import {
  acceptedLine,
  droppedLine,
  readMissionOrder,
  showReport,
} from './hiremeOrders.js';
import { missionLeakPath } from './missionLeak.js';
import { missionShape, type MissionShape } from './missionShape.js';
import { missionKey, missionKeyPath, missionPassphrase } from './missionSecret.js';
import { missionAddressForNumber, missionEssid } from './missionNetwork.js';
import { missionTerms } from './missionTerms.js';
import {
  RECORD_SETTINGS,
  missionAction,
  missionRecords,
  missionSetting,
  type RecordAction,
  type RecordSetting,
} from './missionRecords.js';
import {
  COMMON_PASSWORDS,
  CRACKABLE_PASSWORDS,
  plaintextFor,
  UNCRACKABLE_PASSWORDS,
  WIFI_PASSWORDS,
} from '../../test/passwords.js';
import {
  WEB_ROUTE_LEAK_PATH,
  WEB_ROUTE_NUMBER,
  WEB_ROUTE_WORD,
} from '../../test/factories/webRouteContract.js';

/**
 * What the operator types at `scripts/hireme.ts`, and what `show` prints back. The order
 * parser refuses anything that is not exactly one of the three the script runs, so a near
 * miss is never taken for another; the report names the one thing only an operator can see,
 * the key, beside the address and route a contractor would work out for themselves.
 */

describe('readMissionOrder', () => {
  it('reads an accept of a handle, with no number drawn yet', () => {
    expect(readMissionOrder(['accept', 'alice'])).toEqual({
      verb: 'accept',
      handle: 'alice',
      number: null,
    });
  });

  it('reads an accept at a chosen number', () => {
    expect(readMissionOrder(['accept', 'alice', '--number', '66051'])).toEqual({
      verb: 'accept',
      handle: 'alice',
      number: 66051,
    });
  });

  it('refuses an accept with a --number that is not a non-negative integer', () => {
    expect(readMissionOrder(['accept', 'alice', '--number', 'x'])).toBeNull();
    expect(readMissionOrder(['accept', 'alice', '--number', '-1'])).toBeNull();
    expect(readMissionOrder(['accept', 'alice', '--number', '1.5'])).toBeNull();
  });

  it('refuses an accept with --number but no number after it', () => {
    expect(readMissionOrder(['accept', 'alice', '--number'])).toBeNull();
  });

  it('refuses an accept whose second word is a flag other than --number', () => {
    expect(readMissionOrder(['accept', 'alice', '--count', '1'])).toBeNull();
  });

  it('refuses an accept with a trailing word it does not understand', () => {
    expect(readMissionOrder(['accept', 'alice', 'extra'])).toBeNull();
    expect(readMissionOrder(['accept', 'alice', '--number', '1', 'extra'])).toBeNull();
  });

  it('refuses an accept with no handle, or a handle that looks like a flag', () => {
    expect(readMissionOrder(['accept'])).toBeNull();
    expect(readMissionOrder(['accept', '--number'])).toBeNull();
  });

  it('reads a show of an address', () => {
    expect(readMissionOrder(['show', '195.1.2.3'])).toEqual({ verb: 'show', address: '195.1.2.3' });
  });

  it('reads a drop of a handle', () => {
    expect(readMissionOrder(['drop', 'alice'])).toEqual({ verb: 'drop', handle: 'alice' });
  });

  it('reads a post of fresh offers to a handle', () => {
    expect(readMissionOrder(['post', 'alice'])).toEqual({ verb: 'post', handle: 'alice' });
  });

  it('refuses show, drop and post without exactly one argument', () => {
    expect(readMissionOrder(['show'])).toBeNull();
    expect(readMissionOrder(['show', '195.1.2.3', 'extra'])).toBeNull();
    expect(readMissionOrder(['drop'])).toBeNull();
    expect(readMissionOrder(['drop', 'alice', 'extra'])).toBeNull();
    expect(readMissionOrder(['post'])).toBeNull();
    expect(readMissionOrder(['post', 'alice', 'extra'])).toBeNull();
    expect(readMissionOrder(['post', '--number'])).toBeNull();
  });

  it('refuses an unknown verb and an empty order', () => {
    expect(readMissionOrder(['complete', 'alice'])).toBeNull();
    expect(readMissionOrder([])).toBeNull();
  });
});

describe('showReport', () => {
  const SECRET = 'operator-test-secret';
  /** The first single-hop key job `wanted` accepts: every report below reads one box. */
  const singleHop = (wanted: (shape: MissionShape) => boolean): number =>
    Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find((candidate) => {
      const shape = missionShape(candidate);
      return shape.kind === 'key' && shape.frontBox === null && wanted(shape);
    })!;
  // One number per route, so the report is checked on both. The hydra one keeps its key in a
  // plain file, so the whole report below reads as the simplest contract does.
  const HYDRA = singleHop(({ keyBox, storage }) => keyBox.route === 'hydra' && storage === 'file');
  const MSFCONSOLE = singleHop(
    ({ keyBox, storage }) => keyBox.route === 'msfconsole' && storage === 'file',
  );
  const RAW_SECRETS = JSON.stringify({
    UNCRACKABLE_PASSWORDS,
    CRACKABLE_PASSWORDS,
    COMMON_PASSWORDS,
    WIFI_PASSWORDS,
  });

  it('prints both forwards, the leaked file and the word on a web route', () => {
    const lines = showReport(WEB_ROUTE_NUMBER, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    web');
    expect(lines).toContain('  Forward:  :80 -> key box :80');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain(`  Leak:     ${WEB_ROUTE_LEAK_PATH}`);
    // Through a boolean: a failing `toContain` would print the word.
    expect(lines.includes(`  Word:     ${WEB_ROUTE_WORD}`)).toBe(true);
  });

  it('prints both forwards, the leaked file and the word on an ftp route', () => {
    const number = singleHop(({ keyBox }) => keyBox.route === 'ftp');
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    ftp');
    expect(lines).toContain('  Forward:  :21 -> key box :21');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain(
      `  Leak:     ${missionLeakPath({ missionNumber: number, role: 'key' })}`,
    );
    // Through a boolean: a failing `toContain` would print the word.
    expect(
      lines.includes(`  Word:     ${plaintextFor(missionShape(number).keyBox.rootHash)}`),
    ).toBe(true);
  });

  it('prints both forwards, the datadir and the word on a database route', () => {
    const number = singleHop(({ keyBox }) => keyBox.route === 'mysql');
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    mysql');
    expect(lines).toContain('  Forward:  :3306 -> key box :3306');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain('  Leak:     /var/lib/mysql/data.json');
    // Through a boolean: a failing `toContain` would print the word.
    expect(
      lines.includes(`  Word:     ${plaintextFor(missionShape(number).keyBox.rootHash)}`),
    ).toBe(true);
  });

  it('prints both forwards, the agent config and the word on an snmp route', () => {
    const number = singleHop(({ keyBox }) => keyBox.route === 'snmp');
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    snmp');
    expect(lines).toContain('  Forward:  :161 -> key box :161');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain('  Leak:     /etc/snmp/snmpd.conf');
    // Through a boolean: a failing `toContain` would print the word.
    expect(
      lines.includes(`  Word:     ${plaintextFor(missionShape(number).keyBox.rootHash)}`),
    ).toBe(true);
  });

  it('says so when it cannot read the word, and still prints the rest', () => {
    const lines = showReport(WEB_ROUTE_NUMBER, SECRET, undefined).split('\n');

    expect(lines).toContain(`  Leak:     ${WEB_ROUTE_LEAK_PATH}`);
    expect(lines).toContain('  Word:     (JSHACK_SECRETS is not set)');
  });

  it('prints no leak on a route with none', () => {
    const report = showReport(HYDRA, SECRET, RAW_SECRETS);

    expect(report).not.toContain('Leak:');
    expect(report).not.toContain('Word:');
  });

  it('prints the key only an operator can derive, beside its path', () => {
    const report = showReport(HYDRA, SECRET, undefined);

    expect(report).toContain(missionKey(HYDRA, SECRET));
    expect(report).toContain(missionKeyPath(HYDRA));
  });

  const withStorage = (storage: 'file' | 'gpg' | 'database'): number =>
    singleHop((shape) => shape.storage === storage);

  it('says a plain-file contract keeps its key in a file, at the key path', () => {
    const number = withStorage('file');
    const lines = showReport(number, SECRET, undefined).split('\n');

    expect(lines).toContain('  Storage:  file');
    expect(lines).toContain(`  Key path: ${missionKeyPath(number)}`);
  });

  it('gives a gpg contract the passphrase, and the sealed file as the key path', () => {
    const number = withStorage('gpg');
    const lines = showReport(number, SECRET, undefined).split('\n');

    expect(lines).toContain(`  Storage:  gpg, passphrase ${missionPassphrase(number, SECRET)}`);
    expect(lines).toContain(`  Key path: ${missionKeyPath(number)}.gpg`);
    expect(lines).toContain(`  Key:      ${missionKey(number, SECRET)}`);
  });

  it('sends a database contract to the table in the datadir, with no key file', () => {
    const number = withStorage('database');
    const lines = showReport(number, SECRET, undefined).split('\n');

    expect(lines).toContain('  Storage:  database, table api_keys');
    expect(lines).toContain('  Key path: /var/lib/mysql/data.json');
    expect(lines).toContain(`  Key:      ${missionKey(number, SECRET)}`);
  });

  it('names the contract by its address and essid', () => {
    const report = showReport(HYDRA, SECRET, undefined);

    expect(report).toContain(missionAddressForNumber(HYDRA)!);
    expect(report).toContain(missionEssid(HYDRA));
  });

  it("names the number's actual route", () => {
    expect(showReport(HYDRA, SECRET, undefined)).toContain('hydra');
    expect(showReport(MSFCONSOLE, SECRET, undefined)).toContain('msfconsole');
  });

  // What a test of the mail door needs: whom to mail the key to, and what it should pay.
  it('names the client and its handle, the target company and the pay', () => {
    const terms = missionTerms(HYDRA);
    const report = showReport(HYDRA, SECRET, undefined);

    expect(report).toContain(`${terms.client.company} (${terms.client.handle}@emailit.io)`);
    expect(report).toContain(terms.targetCompany);
    expect(report).toContain(`§${terms.pay.toLocaleString('en-US')}`);
  });

  it('prints the report line by line, every hydra service a decoy', () => {
    // The hydra route runs no daemon of its own, so whatever listens beside its sshd is a decoy.
    const shape = missionShape(HYDRA);
    const terms = missionTerms(HYDRA);

    expect(showReport(HYDRA, SECRET, undefined)).toBe(
      [
        `Contract ${HYDRA} at ${missionAddressForNumber(HYDRA)} (essid ${missionEssid(HYDRA)})`,
        `  Client:   ${terms.client.company} (${terms.client.handle}@emailit.io)`,
        `  Target:   ${terms.targetCompany}, ${shape.stem}-gw / ${shape.stem}-files`,
        `  Pay:      §${terms.pay.toLocaleString('en-US')}`,
        '  Template: single-hop',
        '  Route:    hydra',
        '  Forward:  :2222 -> key box :22',
        ...shape.forwards
          .slice(1)
          .map(
            (forward) =>
              `  Forward:  :${forward.publicPort} -> key box :${forward.internalPort} (decoy)`,
          ),
        '  Services:',
        ...shape.keyBox.services.map(
          (service) =>
            `    ${service.service} (${service.package} ${service.version}) :${service.port} (decoy)`,
        ),
        '  Storage:  file',
        `  Key path: ${missionKeyPath(HYDRA)}`,
        `  Key:      ${missionKey(HYDRA, SECRET)}`,
      ].join('\n'),
    );
  });

  it('lists each service on the key box with its release and port, the route first', () => {
    const shape = missionShape(MSFCONSOLE);
    const [routeService, ...others] = shape.keyBox.services;
    const lines = showReport(MSFCONSOLE, SECRET, undefined).split('\n');

    const storageLine = lines.findIndex((line) => line.startsWith('  Storage:'));

    // The route's own service bears no tag; on a plain-file msfconsole contract every other
    // one is a decoy.
    expect(shape.storage).toBe('file');
    expect(others.length).toBeGreaterThan(0);
    expect(lines.slice(lines.indexOf('  Services:') + 1, storageLine)).toEqual([
      `    ${routeService!.service} (${routeService!.package} ${routeService!.version}) :${routeService!.port}`,
      ...others.map(
        (service) =>
          `    ${service.service} (${service.package} ${service.version}) :${service.port} (decoy)`,
      ),
    ]);
  });

  it('tags a decoy forward and never the route doors or the database the key is kept in', () => {
    const number = singleHop(
      ({ keyBox, storage }) => keyBox.route === 'hydra' && storage === 'database',
    );
    const shape = missionShape(number);
    const lines = showReport(number, SECRET, undefined).split('\n');

    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain('  Forward:  :3306 -> key box :3306');
    expect(
      lines.filter((line) => line.endsWith('(decoy)') && line.includes('Forward:')),
    ).toHaveLength(shape.keyBox.decoys.length);
  });

  it('prints a different key under a different secret, as the two deployments do', () => {
    expect(showReport(HYDRA, 'secret-one', undefined)).not.toBe(
      showReport(HYDRA, 'secret-two', undefined),
    );
  });
});

describe('showReport on a two-hop contract', () => {
  const SECRET = 'operator-test-secret';
  const RAW_SECRETS = JSON.stringify({
    UNCRACKABLE_PASSWORDS,
    CRACKABLE_PASSWORDS,
    COMMON_PASSWORDS,
    WIFI_PASSWORDS,
  });
  /** The first two-hop key job `wanted` accepts. */
  const twoHop = (wanted: (shape: MissionShape) => boolean): number =>
    Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find((candidate) => {
      const shape = missionShape(candidate);
      return shape.kind === 'key' && shape.frontBox !== null && wanted(shape);
    })!;
  const frontOf = (shape: MissionShape) => {
    if (shape.frontBox === null) throw new Error(`contract ${shape.missionNumber} has one hop`);
    return shape.frontBox;
  };

  it('prints the report line by line, each box in a section of its own', () => {
    // A web front box over a hydra key box keeping its key in a plain file: the gateway's
    // forwards all reach the front box, and its decoys are the front box's. The hydra route
    // runs no daemon of its own, so whatever the key box runs beside its sshd is a decoy.
    const number = twoHop(
      ({ frontBox, keyBox, storage }) =>
        frontBox?.route === 'web' && keyBox.route === 'hydra' && storage === 'file',
    );
    const shape = missionShape(number);
    const front = frontOf(shape);
    const terms = missionTerms(number);
    const realForwardCount = shape.forwards.length - front.decoys.length;
    const decoyPorts = shape.forwards
      .slice(realForwardCount)
      .map(({ internalPort }) => internalPort);
    const service = (
      line: { service: string; package: string; version: string; port: number },
      tag: string,
    ): string => `      ${line.service} (${line.package} ${line.version}) :${line.port}${tag}`;

    expect(showReport(number, SECRET, undefined)).toBe(
      [
        `Contract ${number} at ${missionAddressForNumber(number)} (essid ${missionEssid(number)})`,
        `  Client:   ${terms.client.company} (${terms.client.handle}@emailit.io)`,
        `  Target:   ${terms.targetCompany}, ${shape.stem}-gw / ${shape.stem}-web / ${shape.stem}-files`,
        `  Pay:      §${terms.pay.toLocaleString('en-US')}`,
        '  Template: two-hop',
        ...shape.forwards.map(
          (forward, index) =>
            `  Forward:  :${forward.publicPort} -> front box :${forward.internalPort}` +
            (index >= realForwardCount ? ' (decoy)' : ''),
        ),
        `  Front box: ${shape.stem}-web`,
        '    Route:    web',
        '    Services:',
        ...front.services.map((line) =>
          service(line, decoyPorts.includes(line.port) ? ' (decoy)' : ''),
        ),
        `    Leak:     ${missionLeakPath({ missionNumber: number, role: 'front' })}`,
        '    Word:     (JSHACK_SECRETS is not set)',
        `  Key box:   ${shape.stem}-files`,
        '    Route:    hydra',
        '    Services:',
        ...shape.keyBox.services.map((line) => service(line, ' (decoy)')),
        '  Storage:  file',
        `  Key path: ${missionKeyPath(number)}`,
        `  Key:      ${missionKey(number, SECRET)}`,
      ].join('\n'),
    );
  });

  it("prints each leak route's own file and word, in the section of the box it roots", () => {
    const number = twoHop(
      ({ frontBox, keyBox }) => frontBox?.route === 'ftp' && keyBox.route === 'snmp',
    );
    const shape = missionShape(number);
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');
    const keySection = lines.indexOf(`  Key box:   ${shape.stem}-files`);
    const frontLines = lines.slice(0, keySection);
    const keyLines = lines.slice(keySection);
    const frontWord = plaintextFor(frontOf(shape).rootHash);
    const keyWord = plaintextFor(shape.keyBox.rootHash);

    expect(frontWord).not.toBe(keyWord);
    expect(frontLines).toContain(
      `    Leak:     ${missionLeakPath({ missionNumber: number, role: 'front' })}`,
    );
    expect(keyLines).toContain('    Leak:     /etc/snmp/snmpd.conf');
    // Through a boolean: a failing `toContain` would print the word.
    expect(frontLines.includes(`    Word:     ${frontWord}`)).toBe(true);
    expect(keyLines.includes(`    Word:     ${keyWord}`)).toBe(true);
  });

  it('keeps the database a key is kept in off the gateway, and never tags it a decoy', () => {
    // A database front box would forward its own 3306, so the front here is any other route.
    const number = twoHop(
      ({ frontBox, storage }) => storage === 'database' && frontBox?.route !== 'mysql',
    );
    const shape = missionShape(number);
    const lines = showReport(number, SECRET, undefined).split('\n');
    const keySection = lines.indexOf(`  Key box:   ${shape.stem}-files`);

    expect(lines.filter((line) => line.includes('-> key box'))).toEqual([]);
    expect(lines).not.toContain('  Forward:  :3306 -> front box :3306');
    const keyLines = lines.slice(keySection);
    const database = keyLines.filter((line) => line.endsWith(':3306'));

    expect(database).toHaveLength(1);
    expect(keyLines.filter((line) => line.endsWith('(decoy)'))).toHaveLength(
      shape.keyBox.decoys.length,
    );
    expect(lines).toContain('  Storage:  database, table api_keys');
  });
});

describe('showReport on a tamper job', () => {
  const SECRET = 'operator-test-secret';
  /** The first tamper job asking for `action` that `wanted` accepts, in `setting` when one is
   *  named. */
  const tamperJob = (
    action: RecordAction,
    wanted: (shape: MissionShape) => boolean,
    setting?: RecordSetting,
  ): number =>
    Array.from({ length: 8000 }, (_unused, index) => index * 256 + 2).find((candidate) => {
      const shape = missionShape(candidate);
      return (
        shape.kind === 'tamper' &&
        missionAction(candidate) === action &&
        (setting === undefined || missionSetting(candidate) === setting) &&
        wanted(shape)
      );
    })!;
  const SINGLE_HOP = tamperJob(
    'change',
    ({ frontBox, keyBox, storage }) =>
      frontBox === null && keyBox.route === 'hydra' && storage === 'database',
  );
  const TWO_HOP = tamperJob(
    'change',
    ({ frontBox, keyBox, storage }) =>
      frontBox !== null && keyBox.route === 'hydra' && storage === 'database',
  );
  const ERASE = tamperJob(
    'erase',
    ({ frontBox, storage }) => frontBox === null && storage === 'database',
  );
  const FILE_CHANGE = tamperJob('change', ({ storage }) => storage === 'file');
  const FILE_ERASE = tamperJob('erase', ({ storage }) => storage === 'file');

  /** The names a job's target row goes by, as the report lists them. */
  const namesOf = (missionNumber: number): string =>
    Object.values(missionRecords(missionNumber).target.namedBy).join(', ');

  /** The line naming the record a job asks changed or gone. */
  const askedLine = (missionNumber: number, indent: string): string => {
    const { target } = missionRecords(missionNumber);
    return target.action === 'erase'
      ? `${indent}Erase:    ${namesOf(missionNumber)}`
      : `${indent}Change:   ${namesOf(missionNumber)}: ${target.column} ${target.from} -> ${target.to}`;
  };

  /** What the report says the job is, and the record it asks changed, where a key job's
   *  storage, key path and key go. */
  const recordLines = (missionNumber: number, indent: string): readonly string[] => [
    `${indent}Storage:  database, table ${missionRecords(missionNumber).target.table}`,
    `${indent}Records:  /var/lib/mysql/data.json`,
    askedLine(missionNumber, indent),
  ];

  const kindLine = (missionNumber: number): string =>
    `  Kind:     tamper, ${missionSetting(missionNumber)}, ${missionAction(missionNumber)}`;

  it('prints the report line by line, the kind and the record in place of a key', () => {
    const shape = missionShape(SINGLE_HOP);
    const terms = missionTerms(SINGLE_HOP);

    expect(showReport(SINGLE_HOP, SECRET, undefined)).toBe(
      [
        `Contract ${SINGLE_HOP} at ${missionAddressForNumber(SINGLE_HOP)} (essid ${missionEssid(SINGLE_HOP)})`,
        `  Client:   ${terms.client.company} (${terms.client.handle}@emailit.io)`,
        `  Target:   ${terms.targetCompany}, ${shape.stem}-gw / ${shape.stem}-files`,
        `  Pay:      §${terms.pay.toLocaleString('en-US')}`,
        '  Template: single-hop',
        kindLine(SINGLE_HOP),
        '  Route:    hydra',
        ...shape.forwards.map(
          (forward, index) =>
            `  Forward:  :${forward.publicPort} -> key box :${forward.internalPort}` +
            (index >= shape.forwards.length - shape.keyBox.decoys.length ? ' (decoy)' : ''),
        ),
        '  Services:',
        ...shape.keyBox.services.map(
          (service) =>
            // The hydra route runs no daemon of its own: the database holding the records is the
            // one real service, and whatever else listens is a decoy.
            `    ${service.service} (${service.package} ${service.version}) :${service.port}` +
            (service.port === 3306 ? '' : ' (decoy)'),
        ),
        ...recordLines(SINGLE_HOP, '  '),
      ].join('\n'),
    );
  });

  it('prints the record in the key box section of a two-hop job, and no key', () => {
    const report = showReport(TWO_HOP, SECRET, undefined);
    const lines = report.split('\n');
    const keyBoxAt = lines.findIndex((line) => line.startsWith('  Key box:'));

    expect(lines).toContain(kindLine(TWO_HOP));
    expect(lines.slice(keyBoxAt)).toEqual(expect.arrayContaining([...recordLines(TWO_HOP, '  ')]));
    expect(report).not.toContain('Key:');
    expect(report).not.toContain('Key path:');
  });

  it('prints an erase job as one, with the names of the row it asks gone', () => {
    const lines = showReport(ERASE, SECRET, undefined).split('\n');
    const storageAt = lines.indexOf(recordLines(ERASE, '  ')[0] ?? '');

    expect(lines).toContain(kindLine(ERASE));
    expect(lines.slice(storageAt, storageAt + 3)).toEqual(recordLines(ERASE, '  '));
    expect(lines.some((line) => line.includes('Change:'))).toBe(false);
  });

  it.each(RECORD_SETTINGS)('names a %s job by its setting, its table and its row', (setting) => {
    const actions: readonly RecordAction[] =
      setting === 'payroll' ? ['change'] : ['change', 'erase'];
    for (const action of actions) {
      const missionNumber = tamperJob(action, ({ storage }) => storage === 'database', setting);
      const lines = showReport(missionNumber, SECRET, undefined).split('\n');

      expect(lines, `contract ${missionNumber}`).toContain(kindLine(missionNumber));
      expect(lines).toEqual(expect.arrayContaining([...recordLines(missionNumber, '  ')]));
    }
  });

  it('prints a job keeping its records in a file as one, with the file in place of a table', () => {
    for (const missionNumber of [FILE_CHANGE, FILE_ERASE]) {
      const { table } = missionRecords(missionNumber).target;
      const lines = showReport(missionNumber, SECRET, undefined).split('\n');
      const path = `/srv/${missionShape(missionNumber).stem}/records/${table}.csv`;
      const storageAt = lines.indexOf(`  Storage:  file, ${path}`);

      expect(storageAt, `contract ${missionNumber}`).toBeGreaterThan(0);
      expect(lines[storageAt + 1]).toBe(askedLine(missionNumber, '  '));
      expect(lines.some((line) => line.includes('Records:'))).toBe(false);
      expect(lines.some((line) => line.includes('table '))).toBe(false);
    }
  });
});

describe('showReport on a sabotage job', () => {
  const SECRET = 'operator-test-secret';
  /** The first sabotage job `wanted` accepts. */
  const sabotageJob = (wanted: (shape: MissionShape) => boolean): number =>
    Array.from({ length: 8000 }, (_unused, index) => index * 256 + 2).find((candidate) => {
      const shape = missionShape(candidate);
      return shape.kind === 'sabotage' && wanted(shape);
    })!;
  const SINGLE_HOP = sabotageJob(
    ({ frontBox, keyBox }) => frontBox === null && keyBox.route === 'hydra',
  );
  const TWO_HOP = sabotageJob(({ frontBox }) => frontBox !== null);

  it('prints the report line by line, the kind and the target in place of a key', () => {
    const shape = missionShape(SINGLE_HOP);
    const terms = missionTerms(SINGLE_HOP);

    expect(showReport(SINGLE_HOP, SECRET, undefined)).toBe(
      [
        `Contract ${SINGLE_HOP} at ${missionAddressForNumber(SINGLE_HOP)} (essid ${missionEssid(SINGLE_HOP)})`,
        `  Client:   ${terms.client.company} (${terms.client.handle}@emailit.io)`,
        `  Target:   ${terms.targetCompany}, ${shape.stem}-gw / ${shape.stem}-nvr`,
        `  Pay:      §${terms.pay.toLocaleString('en-US')}`,
        '  Template: single-hop',
        '  Kind:     sabotage, CCTV recorder',
        '  Route:    hydra',
        ...shape.forwards.map(
          (forward, index) =>
            `  Forward:  :${forward.publicPort} -> target :${forward.internalPort}` +
            (index >= shape.forwards.length - shape.keyBox.decoys.length ? ' (decoy)' : ''),
        ),
        '  Services:',
        ...shape.keyBox.services.map(
          // The hydra route runs no daemon of its own and the target keeps nothing, so whatever
          // listens is a decoy.
          (service) =>
            `    ${service.service} (${service.package} ${service.version}) :${service.port} (decoy)`,
        ),
      ].join('\n'),
    );
  });

  it('names the target box by its hostname on a two-hop job, and prints no key', () => {
    const { stem } = missionShape(TWO_HOP);
    const report = showReport(TWO_HOP, SECRET, undefined);
    const lines = report.split('\n');

    expect(lines).toContain('  Kind:     sabotage, CCTV recorder');
    expect(lines).toContain(`  Target box: ${stem}-nvr`);
    expect(report).not.toContain('Key');
    expect(report).not.toContain('Storage:');
  });
});

describe('the lines the script prints with an address', () => {
  it('names the address an accepted contract now answers at', () => {
    const line = acceptedLine('alice', 66051, '195.1.2.3');

    expect(line).toContain('alice');
    expect(line).toContain('66051');
    expect(line).toContain('195.1.2.3');
  });

  it('names the address a dropped contract still answers at', () => {
    const line = droppedLine('alice', 66051, '195.1.2.3');

    expect(line).toContain('alice');
    expect(line).toContain('66051');
    expect(line).toContain('195.1.2.3');
  });
});
