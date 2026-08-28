import { describe, expect, it } from 'vitest';
import { parseAgentAddress } from './agentAddress';

/**
 * `<host>` or `<host>:<port>` — net-snmp's own way of naming an agent, and here the
 * only way to name a device that answers from behind a forward.
 *
 * The port is the whole of how a hidden box is addressed: the address belongs to the
 * gateway the request goes through, and the port picks which of its forwards to follow.
 *
 * A suffix that is not a port is not one. The whole string stays the address, finds no
 * such host, and gets the door's single silence — one code path and no second failure
 * sentence to keep in step with the first. That also keeps this parser out of the
 * business of deciding what is reachable, which is the server's alone.
 */

describe('naming an agent', () => {
  it('takes a bare address as the agent itself', () => {
    expect(parseAgentAddress('192.168.188.7')).toEqual({ targetIp: '192.168.188.7' });
  });

  it('splits a port off the address it is attached to', () => {
    expect(parseAgentAddress('192.168.188.7:2222')).toEqual({
      targetIp: '192.168.188.7',
      port: 2222,
    });
  });

  it('accepts the port boundaries', () => {
    expect(parseAgentAddress('192.168.188.7:1')).toEqual({ targetIp: '192.168.188.7', port: 1 });
    expect(parseAgentAddress('192.168.188.7:65535')).toEqual({
      targetIp: '192.168.188.7',
      port: 65535,
    });
  });

  it('keeps a suffix that is not a port as part of the address', () => {
    // Not an error of its own. There is no host by that name, so it answers with the
    // same silence every other unreachable device does — and a player who typed a port
    // wrong learns it the same way they learn a device is not there.
    for (const typed of [
      '192.168.188.7:abc',
      '192.168.188.7:',
      '192.168.188.7:0',
      '192.168.188.7:99999',
      '192.168.188.7:22.5',
      '192.168.188.7:-22',
      '192.168.188.7: 22',
    ]) {
      expect(parseAgentAddress(typed)).toEqual({ targetIp: typed });
    }
  });

  it('splits on the LAST colon, so only the final field can be a port', () => {
    // Nothing in this world hands out addresses with colons in them, but the rule has to
    // be stated somewhere or the answer depends on which colon the parser happened to
    // find first.
    expect(parseAgentAddress('a:b:2222')).toEqual({ targetIp: 'a:b', port: 2222 });
  });
});
