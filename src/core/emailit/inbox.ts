/**
 * An inbox on the wire: the shape a message takes, listed or opened, as the store answers
 * it and as the server sends it on. The server and the client both read it with this, so
 * the two ends cannot disagree about a message, and the client takes nothing of the
 * server's code with it.
 */

import { z } from 'zod';

/** One message as a list shows it. `number` is its place in its inbox, kept
 *  until it is deleted; `delivered_at` is when the server delivered it. */
export const listedMessageSchema = z.object({
  number: z.number().int().positive(),
  sender: z.string(),
  subject: z.string(),
  delivered_at: z.string(),
  read: z.boolean(),
});

/** The one file a message may carry: its name, never the sender's path, and its content
 *  byte for byte. */
export const mailAttachmentSchema = z.object({
  name: z.string(),
  content: z.string(),
});

/** One message opened to be read: what the list shows of it, its body as written, and the
 *  file it carries. The store says `null` for a message that carries none, and the wire then
 *  leaves the field out. */
export const openedMessageSchema = z.object({
  number: z.number().int().positive(),
  sender: z.string(),
  subject: z.string(),
  delivered_at: z.string(),
  body: z.string(),
  attachment: mailAttachmentSchema.nullish().transform((attachment) => attachment ?? undefined),
});
