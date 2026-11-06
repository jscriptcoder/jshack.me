import { describe, expect, it } from 'vitest';
import {
  acceptedLine,
  droppedLine,
  readMissionOrder,
  showReport,
} from './hiremeOrders.js';
import { missionLeakPath } from './missionLeak.js';
import { missionShape } from './missionShape.js';
import { missionKey, missionKeyPath } from './missionSecret.js';
import { missionAddressForNumber, missionEssid } from './missionNetwork.js';
import { missionTerms } from './missionTerms.js';
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
  // One number per route, so the report is checked on both.
  const HYDRA = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
    (candidate) => missionShape(candidate).route === 'hydra',
  )!;
  const MSFCONSOLE = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
    (candidate) => missionShape(candidate).route === 'msfconsole',
  )!;
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
    const number = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
      (candidate) => missionShape(candidate).route === 'ftp',
    )!;
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    ftp');
    expect(lines).toContain('  Forward:  :21 -> key box :21');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain(`  Leak:     ${missionLeakPath(number)}`);
    // Through a boolean: a failing `toContain` would print the word.
    expect(
      lines.includes(`  Word:     ${plaintextFor(missionShape(number).keyBoxRootHash)}`),
    ).toBe(true);
  });

  it('prints both forwards, the datadir and the word on a database route', () => {
    const number = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
      (candidate) => missionShape(candidate).route === 'mysql',
    )!;
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    mysql');
    expect(lines).toContain('  Forward:  :3306 -> key box :3306');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain('  Leak:     /var/lib/mysql/data.json');
    // Through a boolean: a failing `toContain` would print the word.
    expect(
      lines.includes(`  Word:     ${plaintextFor(missionShape(number).keyBoxRootHash)}`),
    ).toBe(true);
  });

  it('prints both forwards, the agent config and the word on an snmp route', () => {
    const number = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
      (candidate) => missionShape(candidate).route === 'snmp',
    )!;
    const lines = showReport(number, SECRET, RAW_SECRETS).split('\n');

    expect(lines).toContain('  Route:    snmp');
    expect(lines).toContain('  Forward:  :161 -> key box :161');
    expect(lines).toContain('  Forward:  :2222 -> key box :22');
    expect(lines).toContain('  Leak:     /etc/snmp/snmpd.conf');
    // Through a boolean: a failing `toContain` would print the word.
    expect(
      lines.includes(`  Word:     ${plaintextFor(missionShape(number).keyBoxRootHash)}`),
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

  it('prints the report line by line, a key box with no services saying so', () => {
    const shape = missionShape(HYDRA);
    const terms = missionTerms(HYDRA);

    expect(showReport(HYDRA, SECRET, undefined)).toBe(
      [
        `Contract ${HYDRA} at ${missionAddressForNumber(HYDRA)} (essid ${missionEssid(HYDRA)})`,
        `  Client:   ${terms.client.company} (${terms.client.handle}@emailit.io)`,
        `  Target:   ${terms.targetCompany}, ${shape.stem}-gw / ${shape.stem}-files`,
        `  Pay:      §${terms.pay.toLocaleString('en-US')}`,
        '  Route:    hydra',
        ...shape.forwards.map(
          (forward) => `  Forward:  :${forward.publicPort} -> key box :${forward.internalPort}`,
        ),
        '  Services:',
        '    (none beyond the route)',
        `  Key path: ${missionKeyPath(HYDRA)}`,
        `  Key:      ${missionKey(HYDRA, SECRET)}`,
      ].join('\n'),
    );
  });

  it('lists each service on the key box with its release and port', () => {
    const [service] = missionShape(MSFCONSOLE).keyBoxServices;
    const lines = showReport(MSFCONSOLE, SECRET, undefined).split('\n');

    expect(lines.slice(lines.indexOf('  Services:') + 1, -2)).toEqual([
      `    ${service!.service} (${service!.package} ${service!.version}) :${service!.port}`,
    ]);
  });

  it('prints a different key under a different secret, as the two deployments do', () => {
    expect(showReport(HYDRA, 'secret-one', undefined)).not.toBe(
      showReport(HYDRA, 'secret-two', undefined),
    );
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
