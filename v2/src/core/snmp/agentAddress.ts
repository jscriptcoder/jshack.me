/**
 * `<host>` or `<host>:<port>` — how a player names the agent they are talking to, in
 * net-snmp's own spelling.
 *
 * A bare address is the device standing at it. An address with a port names a device
 * BEHIND the one at that address: the gateway forwards the port onward, and through a
 * forward the port is the whole of how a hidden box is named at all. It is also the same
 * spelling the door writes as a VALUE (`natForward.2222=10.42.7.9:22`), so an address
 * and a port look the same everywhere in this protocol.
 *
 * A suffix that is not a port is NOT AN ERROR here. The whole string stays the address,
 * finds no such host, and gets the door's single silence — one code path, and no second
 * failure sentence competing with the one every other unreachable device already gets.
 *
 * Splitting an argument is not parsing a rule: nothing here decides what is reachable,
 * which stays the server's alone. This exists so the client can say WHICH BOX, not
 * whether it may be talked to.
 */

const PORT_SUFFIX_RE = /^(\d{1,5})$/;

const MAX_PORT = 65535;

export type AgentAddress = {
  readonly targetIp: string;
  /** Absent when the address names the device directly — the agent's own port is the
   *  server's default, and a client that stated it would be a client that could be told
   *  to state a different one. */
  readonly port?: number;
};

export const parseAgentAddress = (typed: string): AgentAddress => {
  const separator = typed.lastIndexOf(':');
  if (separator === -1) return { targetIp: typed };

  const suffix = typed.slice(separator + 1);
  const port = PORT_SUFFIX_RE.test(suffix) ? Number(suffix) : 0;
  return port >= 1 && port <= MAX_PORT ? { targetIp: typed.slice(0, separator), port } : { targetIp: typed };
};
