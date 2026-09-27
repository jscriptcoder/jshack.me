import { describe, expect, it } from 'vitest';
import { describeSet, parseSnmpSet } from './set';
import { forwardOid } from './walk';

/**
 * `forward.<port>=<ip>:<port>` and `aclPort.<port>=deny` — the whole of what a
 * player may write through this door.
 *
 * The value names the STATE the port should be in, never an operation, so `none` and
 * `permit` are values in the same sense `deny` is. That is why one grammar covers add,
 * overwrite and remove, and why there is no verb anywhere in it.
 *
 * The grammar is parsed SERVER-side and nowhere else. A client that parsed it would be
 * a second authority on what a rule is, next to the file's own parser — the exact shape
 * this door was designed to avoid — and would be a client that could be told what to
 * send.
 *
 * TWO refusal reasons, and the split is the OID's own: the port is part of the NAME, so
 * a port outside 1–65535 names an instance that does not exist (`noSuchName`), while a
 * destination the file's parser rejects is a bad VALUE for a name that does
 * (`wrongValue`). The failed object follows the same line — canonical when the name
 * exists, and the player's own text when it does not.
 */

describe('parsing what a player asked to set', () => {
  it('reads a forward onto a destination', () => {
    expect(parseSnmpSet('forward.2222=192.168.188.10:22')).toEqual({
      ok: true,
      target: {
        kind: 'nat',
        publicPort: 2222,
        forward: { internalIp: '192.168.188.10', internalPort: 22 },
      },
    });
  });

  it('reads `none` as the state of forwarding nowhere', () => {
    // Removal is state-valued: the port ends up forwarding nowhere, which is what a
    // default-deny router's every other port already does. An imperative (`=delete`)
    // would be an instruction sitting where a value goes.
    expect(parseSnmpSet('forward.2222=none')).toEqual({
      ok: true,
      target: { kind: 'nat', publicPort: 2222, forward: null },
    });
  });

  it('reads a switch port shut and open again', () => {
    expect(parseSnmpSet('aclPort.8080=deny')).toEqual({
      ok: true,
      target: { kind: 'acl', port: 8080, denied: true },
    });
    expect(parseSnmpSet('aclPort.8080=permit')).toEqual({
      ok: true,
      target: { kind: 'acl', port: 8080, denied: false },
    });
  });
});

describe('refusing what cannot be set', () => {
  it('refuses an OID this door does not model, naming the text the player typed', () => {
    // The identity OIDs are READ-ONLY facts about the device — `sysName` IS the
    // hostname — so there is nothing here to write them into. Nothing canonical to
    // echo either, which is why the failed object is what was typed.
    expect(parseSnmpSet('sysDescr.0=something')).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'sysDescr.0',
      },
    });
  });

  it('refuses a port outside the range as a name that does not exist', () => {
    expect(parseSnmpSet('forward.99999=192.168.188.10:22')).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'forward.99999',
      },
    });
    expect(parseSnmpSet('aclPort.0=deny')).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'aclPort.0',
      },
    });
  });

  it('echoes an assignment carrying no "=" at all back WHOLE', () => {
    // There is no name and no value here, only what the player typed — and the failed
    // object is the only place the device tells them which part it could not read. A
    // parser that treated the missing separator as a position would hand back the same
    // text a character short, which reads as a typo the device invented.
    expect(parseSnmpSet('inputPort6379deny')).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'inputPort6379deny',
      },
    });
  });

  it("refuses a destination the file's own parser will not read back", () => {
    // The gate is `parseForwardRules` itself, run over the line this would write. A
    // destination only this door understood would be a forward the scan path and the
    // ssh router cannot see — a rule that exists in a walk and nowhere else.
    const refusal = {
      reason: 'wrongValue',
      detail: 'not an address and port, or "none"',
      failedObject: 'forward.2222',
    };
    expect(parseSnmpSet('forward.2222=nonsense')).toEqual({ ok: false, refusal });
    expect(parseSnmpSet('forward.2222=192.168.188.10')).toEqual({ ok: false, refusal });
    expect(parseSnmpSet('forward.2222=192.168.188.10:0')).toEqual({ ok: false, refusal });
  });

  it('refuses an empty value rather than reading it as a removal', () => {
    // `=none` is the removal. An empty right-hand side is invisible in scrollback and
    // one keystroke from a typo, so it must not quietly clear a forward.
    expect(parseSnmpSet('forward.2222=')).toEqual({
      ok: false,
      refusal: {
        reason: 'wrongValue',
        detail: 'not an address and port, or "none"',
        failedObject: 'forward.2222',
      },
    });
  });

  it('refuses an OID with anything before or after the name it recognises', () => {
    // Anchored at BOTH ends, in the shape every parser at this door uses. Unanchored at
    // the front, `xforward.2222` would set a forward the player never named; at the
    // back, `forward.2222junk` would set port 2222 while its owner reads the line as
    // something else entirely.
    expect(parseSnmpSet('xforward.2222=192.168.188.10:22')).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'xforward.2222',
      },
    });
    expect(parseSnmpSet('forward.2222junk=192.168.188.10:22')).toEqual({
      ok: false,
      refusal: {
        reason: 'noSuchName',
        detail: 'The name does not exist in the MIB',
        failedObject: 'forward.2222junk',
      },
    });
  });

  it('accepts the port boundaries and refuses what sits just outside them', () => {
    expect(parseSnmpSet('forward.1=192.168.188.10:22')).toMatchObject({ ok: true });
    expect(parseSnmpSet('aclPort.65535=deny')).toMatchObject({ ok: true });
    expect(parseSnmpSet('aclPort.65536=deny')).toMatchObject({
      ok: false,
      refusal: { reason: 'noSuchName' },
    });
  });

  it('refuses a value carrying a second rule, rather than smuggling it into the file', () => {
    // The gate is `parseForwardRules` over the line this would write, and a newline in
    // the value makes that two rules rather than one. Accepted, it would open a port
    // nobody named and nothing echoed — invisible to the player who typed it and to the
    // owner reading their own file.
    expect(parseSnmpSet('forward.2222=192.168.188.10:22\nforward 23 to 10.9.9.9:23')).toEqual({
      ok: false,
      refusal: {
        reason: 'wrongValue',
        detail: 'not an address and port, or "none"',
        failedObject: 'forward.2222',
      },
    });
  });

  it('refuses a switch value that is neither state', () => {
    expect(parseSnmpSet('aclPort.8080=maybe')).toEqual({
      ok: false,
      refusal: {
        reason: 'wrongValue',
        detail: 'not "deny" or "permit"',
        failedObject: 'aclPort.8080',
      },
    });
  });
});

describe('what the device echoes back', () => {
  it('names the OID and the state the port is now in', () => {
    expect(
      describeSet({
        kind: 'nat',
        publicPort: 2222,
        forward: { internalIp: '192.168.188.10', internalPort: 22 },
      }),
    ).toEqual({ oid: 'forward.2222', value: '192.168.188.10:22' });

    expect(describeSet({ kind: 'nat', publicPort: 2222, forward: null })).toEqual({
      oid: 'forward.2222',
      value: 'none',
    });

    expect(describeSet({ kind: 'acl', port: 8080, denied: true })).toEqual({
      oid: 'aclPort.8080',
      value: 'deny',
    });

    expect(describeSet({ kind: 'acl', port: 8080, denied: false })).toEqual({
      oid: 'aclPort.8080',
      value: 'permit',
    });
  });

  it('echoes the same OID a walk of the same device prints', () => {
    // One device, two commands, one spelling. A set that echoed an OID the walk does
    // not print would read as a different fact than the one it changed.
    const { oid } = describeSet({
      kind: 'nat',
      publicPort: 2222,
      forward: { internalIp: '192.168.188.10', internalPort: 22 },
    });
    expect(oid).toBe(forwardOid(2222));
  });
});

/**
 * The third thing a player may write: a port on the box's OWN filter.
 *
 * Same two states as a switch's access list and a deliberately different OID, because
 * they are different facts in different files — a switch shuts a port BEHIND it, a host
 * shuts one ON itself. One spelling for both would let a player aim a switch's syntax at
 * a workstation and be told it worked.
 */
describe('setting a port on the box that answers', () => {
  it('reads a host port shut and open again', () => {
    expect(parseSnmpSet('inputPort.6379=deny')).toEqual({
      ok: true,
      target: { kind: 'filter', port: 6379, denied: true },
    });

    expect(parseSnmpSet('inputPort.6379=permit')).toEqual({
      ok: true,
      target: { kind: 'filter', port: 6379, denied: false },
    });
  });

  it('refuses a filter value that is neither state, naming the OID it does know', () => {
    expect(parseSnmpSet('inputPort.6379=drop')).toEqual({
      ok: false,
      refusal: {
        reason: 'wrongValue',
        detail: 'not "deny" or "permit"',
        failedObject: 'inputPort.6379',
      },
    });
  });

  it('refuses a filter port outside the range as a name that does not exist', () => {
    expect(parseSnmpSet('inputPort.0=deny')).toMatchObject({
      ok: false,
      refusal: { reason: 'noSuchName', failedObject: 'inputPort.0' },
    });
    expect(parseSnmpSet('inputPort.65536=deny')).toMatchObject({
      ok: false,
      refusal: { reason: 'noSuchName', failedObject: 'inputPort.65536' },
    });
    expect(parseSnmpSet('inputPort.65535=deny')).toMatchObject({ ok: true });
  });

  it('echoes the port in the state it is now in, under the chain its own walk prints', () => {
    // The echo IS the confirmation, so it has to be the spelling the walk uses. A set
    // answering with an OID the walk never prints would read as a different fact than
    // the one it just changed.
    expect(describeSet({ kind: 'filter', port: 6379, denied: true })).toEqual({
      oid: 'inputPort.6379',
      value: 'deny',
    });
    expect(describeSet({ kind: 'filter', port: 6379, denied: false })).toEqual({
      oid: 'inputPort.6379',
      value: 'permit',
    });
  });

  it("keeps a switch's own syntax pointing at a switch's own file", () => {
    // Two tables that both deny ports, one grammar apart. If `aclPort` and `inputPort`
    // parsed to the same target, a write aimed at either file would land in whichever
    // one the door happened to consult.
    expect(parseSnmpSet('aclPort.6379=deny')).toEqual({
      ok: true,
      target: { kind: 'acl', port: 6379, denied: true },
    });
  });
});
