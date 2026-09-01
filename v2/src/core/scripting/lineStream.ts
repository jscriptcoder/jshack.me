/**
 * The bridge between output that is PUSHED and a command result that is PULLED.
 *
 * A streamed command narrates its own steps, so it can be written as a generator
 * that yields where it pauses (see `commands/streaming.ts`). A script cannot:
 * `console.log` is called from arbitrary depth inside the player's own code —
 * inside a loop, a callback, a function three frames down — and none of those
 * places can `yield`. So the producer pushes into a queue and a generator drains
 * it, waking whenever something arrives and ending when the producer closes.
 *
 * ONE stream carries everything, and that is load-bearing rather than incidental:
 * the script's own console and every inner command's passthrough go through the
 * same queue, so the order lines are painted in IS the order they were produced
 * in. A second channel — a fast path for the script's own voice, say — would be
 * a way for those two to disagree.
 */

import type { TerminalLine } from '../commands/types';

export type LineStream = {
  /** Hand a line to whoever is draining. Safe before draining starts: it queues. */
  readonly emit: (line: TerminalLine) => void;
  /** No more lines are coming. Ends the drain once the queue is empty. */
  readonly close: () => void;
  /** Every line, in push order, ending after `close` and the last queued line. */
  readonly lines: AsyncGenerator<TerminalLine, void>;
};

export const createLineStream = (): LineStream => {
  // The queue is mutable, deliberately and locally: a producer/consumer buffer is
  // the shape this problem has, and copying the whole backlog per line would make
  // a chatty script quadratic. Nothing outside this closure can see it.
  const queue: TerminalLine[] = [];
  let closed = false;
  let wake: (() => void) | undefined;

  /** Release the drain if it is parked. Dropping the handle first means a wake
   *  that arrives while the drain is running does not park it again. */
  const signal = (): void => {
    const parked = wake;
    wake = undefined;
    parked?.();
  };

  async function* drain(): AsyncGenerator<TerminalLine, void> {
    for (;;) {
      // Taken in batches rather than one at a time: `splice` hands back
      // everything queued and empties the buffer, so there is no "length said
      // one, shift gave undefined" case to guard against with a branch nothing
      // can reach. The re-check is load-bearing though — a line pushed WHILE
      // this batch is being yielded arrives after the snapshot, and closing
      // without looking again would drop it.
      while (queue.length > 0) {
        for (const next of queue.splice(0)) {
          yield next;
        }
      }
      // Checked AFTER the queue is empty, not before: closing must still deliver
      // whatever was already pushed. A script that logs and then throws in the
      // same tick would otherwise lose the line explaining what it was doing.
      if (closed) return;
      // Nothing can slip past here — parking the handle happens synchronously
      // inside the executor, so any `emit` that runs later finds it set.
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  return {
    emit: (line) => {
      queue.push(line);
      signal();
    },
    close: () => {
      closed = true;
      signal();
    },
    lines: drain(),
  };
};
