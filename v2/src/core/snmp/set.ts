/**
 * What a player may WRITE through this door, and what the device says when they may
 * not: `natForward.<port>=<ip>:<port>` on a router, `aclPort.<port>=deny` on a switch.
 *
 * The value names the STATE the port should be left in, never an operation. `none` and
 * `permit` are values in the same sense `deny` is, which is why one grammar covers
 * adding, overwriting and removing, and why there is no verb anywhere in it. An
 * imperative would sit in the one position the protocol reserves for a value.
 *
 * Parsed SERVER-side and nowhere else. A client that parsed it would be a second
 * authority on what a rule is — standing next to the file's own parser, which is the
 * one thing this whole door was shaped to avoid — and a client that could be told what
 * to send.
 *
 * The DESTINATION is not validated here. It is handed to `parseForwardRules`, the same
 * function the scan path and the ssh router read the file with, and accepted only if it
 * reads back as exactly one rule. So nothing can be written that the rest of the world
 * cannot see, and a value carrying a newline cannot smuggle a second rule in: what
 * survives is the PARSED destination, never the player's text.
 *
 * TWO refusal reasons, split where the OID itself splits. The port is part of the NAME,
 * so a port outside 1–65535 names an instance that does not exist (`noSuchName`); a
 * destination the parser rejects is a bad VALUE for a name that does (`wrongValue`).
 * The failed object follows the same line — canonical when the name exists, and the
 * player's own text when there is no canonical form to give back.
 */

import { parseForwardRules, type ForwardTarget } from '../network/iptablesRules';
import { aclPortOid, natForwardOid } from './walk';

/** The state one port should be left in — a router's destination (or none), or a
 *  switch's shut/open. Tagged by the FILE that holds it, matching `SnmpPortTable`, so
 *  the write and the read of one device agree about which fact is being named. */
export type SnmpSetTarget =
  | { readonly kind: 'nat'; readonly publicPort: number; readonly forward: ForwardTarget | null }
  | { readonly kind: 'acl'; readonly port: number; readonly denied: boolean };

/** An error PDU's three moving parts, as real net-snmp prints them. */
export type SnmpSetRefusal = {
  readonly reason: 'noSuchName' | 'wrongValue';
  readonly detail: string;
  readonly failedObject: string;
};

export type ParsedSnmpSet =
  | { readonly ok: true; readonly target: SnmpSetTarget }
  | { readonly ok: false; readonly refusal: SnmpSetRefusal };

/** What the device echoes after an accepted set: the OID, and the state it now holds. */
export type SnmpSetEcho = { readonly oid: string; readonly value: string };

const SET_OID_RE = /^(natForward|aclPort)\.(\d+)$/;

const NO_SUCH_NAME = 'The name does not exist in the MIB';

const inPortRange = (port: number): boolean => port >= 1 && port <= 65535;

const refuse = (
  reason: SnmpSetRefusal['reason'],
  detail: string,
  failedObject: string,
): ParsedSnmpSet => ({ ok: false, refusal: { reason, detail, failedObject } });

/** The destination as the router's own file reads it, or `null` when that file would
 *  not read it at all. `none` is a state rather than a destination and never reaches
 *  here. */
const forwardTarget = (publicPort: number, value: string): ForwardTarget | null => {
  const [rule, ...rest] = parseForwardRules(`forward ${publicPort} to ${value}`);
  if (rule === undefined || rest.length > 0) return null;
  return { internalIp: rule.internalIp, internalPort: rule.internalPort };
};

const parseNatSet = (publicPort: number, value: string): ParsedSnmpSet => {
  if (value === 'none') {
    return { ok: true, target: { kind: 'nat', publicPort, forward: null } };
  }
  const forward = forwardTarget(publicPort, value);
  return forward === null
    ? refuse('wrongValue', 'not an address and port, or "none"', natForwardOid(publicPort))
    : { ok: true, target: { kind: 'nat', publicPort, forward } };
};

const parseAclSet = (port: number, value: string): ParsedSnmpSet =>
  value === 'deny' || value === 'permit'
    ? { ok: true, target: { kind: 'acl', port, denied: value === 'deny' } }
    : refuse('wrongValue', 'not "deny" or "permit"', aclPortOid(port));

/** One `<oid>=<value>` assignment as the state it asks for, or the refusal the device
 *  answers with. Everything after the first `=` is the value, so a destination is never
 *  cut short by the colon inside it. */
export const parseSnmpSet = (assignment: string): ParsedSnmpSet => {
  const separator = assignment.indexOf('=');
  const oidText = separator === -1 ? assignment : assignment.slice(0, separator);
  const value = separator === -1 ? '' : assignment.slice(separator + 1);

  const named = SET_OID_RE.exec(oidText);
  const port = Number(named?.[2]);
  if (named === null || !inPortRange(port)) {
    return refuse('noSuchName', NO_SUCH_NAME, oidText);
  }

  return named[1] === 'natForward' ? parseNatSet(port, value) : parseAclSet(port, value);
};

/** The OID and the value a set echoes back — the same spelling a walk of the device
 *  prints, because it is the same fact. */
export const describeSet = (target: SnmpSetTarget): SnmpSetEcho =>
  target.kind === 'nat'
    ? {
        oid: natForwardOid(target.publicPort),
        value:
          target.forward === null
            ? 'none'
            : `${target.forward.internalIp}:${target.forward.internalPort}`,
      }
    : { oid: aclPortOid(target.port), value: target.denied ? 'deny' : 'permit' };
