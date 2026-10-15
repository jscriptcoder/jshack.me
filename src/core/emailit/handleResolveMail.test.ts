import { describe, expect, it, vi } from 'vitest';
import { generateIdentity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import { computeApGatewayId } from '../identity/router.js';
import { EMAILIT_DOMAIN, EMAILIT_NETWORK } from '../generation/fixedSites.js';
import { siteAddress } from '../generation/publisher.js';
import { md5 } from '../generation/md5.js';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs.js';
import {
  handleResolveMail,
  type DeleteMessage,
  type OpenInbox,
  type OpenMessage,
  type ResolveMailDeps,
  type SendMessage,
} from './handleResolveMail.js';

const freshStore = async () => ({ fresh: true });
const BOB = generateIdentity();
const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';
const EMAILIT_ID = computeApGatewayId(EMAILIT_NETWORK);

const WELCOME = {
  number: 1,
  sender: 'noreply@emailit.io',
  subject: 'Welcome to emailit.io',
  delivered_at: '2026-10-15T09:12:03.123456+00:00',
  read: false,
};

const WELCOME_OPENED = {
  number: 1,
  sender: 'noreply@emailit.io',
  subject: 'Welcome to emailit.io',
  delivered_at: '2026-10-15T09:12:03.123456+00:00',
  body: 'Welcome to emailit.io, neo.\n',
};

/** emailit.io's box as the world generates it, with `journal` written over it. */
const makeDeps = (
  over: {
    readonly openInbox?: OpenInbox;
    readonly openMessage?: OpenMessage;
    readonly sendMessage?: SendMessage;
    readonly deleteMessage?: DeleteMessage;
    readonly journal?: readonly OwnerPatchRow[];
  } = {},
) => {
  const openMessage = vi.fn(
    over.openMessage ??
      (async () => ({ data: { outcome: 'opened', message: WELCOME_OPENED }, error: null })),
  );
  const openInbox = vi.fn(
    over.openInbox ??
      (async () => ({ data: { outcome: 'opened', messages: [WELCOME] }, error: null })),
  );
  const sendMessage = vi.fn(
    over.sendMessage ?? (async () => ({ data: { outcome: 'sent' }, error: null })),
  );
  const deleteMessage = vi.fn(
    over.deleteMessage ?? (async () => ({ data: { outcome: 'deleted' }, error: null })),
  );
  const findNetworkByPublicIp = vi.fn(async (publicIp: string) => ({
    data:
      publicIp === EMAILIT_IP ? { router_machine_id: EMAILIT_ID, essid: EMAILIT_NETWORK } : null,
    error: null,
  }));
  const deps: ResolveMailDeps = {
    nonceStore: freshStore,
    findNetworkByPublicIp,
    findPatches: async ({ machine_id }) => ({
      data: machine_id === EMAILIT_ID ? (over.journal ?? []) : [],
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    openInbox,
    openMessage,
    sendMessage,
    deleteMessage,
  };
  return { deps, openInbox, openMessage, sendMessage, deleteMessage, findNetworkByPublicIp };
};

const inboxRequest = (fields: Record<string, unknown> = {}) =>
  signRequest(BOB, 'resolveMail', { op: 'list', handle: 'neo', password: 's3cret', ...fields });

describe('emailit.io opens an inbox to whoever holds its password', () => {
  it('answers the inbox of the handle whose password was given', async () => {
    const { deps } = makeDeps();

    expect(await handleResolveMail(inboxRequest(), deps)).toEqual({
      status: 200,
      body: { ok: true, messages: [WELCOME] },
    });
  });

  it('asks the store with the md5 of the password, never the password, on the signed key', async () => {
    const { deps, openInbox } = makeDeps();

    await handleResolveMail(inboxRequest(), deps);

    expect(openInbox).toHaveBeenCalledWith({
      handle: 'neo',
      passwordMd5: md5('s3cret'),
      playerKey: BOB.publicKeyHex,
    });
  });

  it('asks emailit.io and no other box, whatever the request carries', async () => {
    const { deps, findNetworkByPublicIp } = makeDeps();

    await handleResolveMail(inboxRequest({ target: '203.0.113.7' }), deps);

    expect(findNetworkByPublicIp.mock.calls).toEqual([[EMAILIT_IP]]);
  });

  it('says only that the login failed when the store does not open the inbox', async () => {
    const { deps } = makeDeps({
      openInbox: async () => ({ data: { outcome: 'login_failed' }, error: null }),
    });

    expect(await handleResolveMail(inboxRequest(), deps)).toEqual({
      status: 401,
      body: { error: 'login_failed' },
    });
  });

  it('says the player must wait when the store is holding their guesses back', async () => {
    const { deps } = makeDeps({
      openInbox: async () => ({ data: { outcome: 'throttled' }, error: null }),
    });

    expect(await handleResolveMail(inboxRequest(), deps)).toEqual({
      status: 429,
      body: { error: 'throttled' },
    });
  });

  it('opens nothing while emailit.io will not come up', async () => {
    const { deps, openInbox } = makeDeps({
      journal: [
        // Root removed its kernel: replayed, the box cannot boot.
        {
          path: '/boot/vmlinuz',
          content: null,
          owner: 'root',
          permissions: null,
          node_type: null,
          updated_at: '2026-10-15T09:00:00.000Z',
          writer_key: BOB.publicKeyHex,
        },
      ],
    });

    expect(await handleResolveMail(inboxRequest(), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(openInbox).not.toHaveBeenCalled();
  });

  it('reports a store it could not ask as a server error, not a failed login', async () => {
    const { deps } = makeDeps({
      openInbox: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveMail(inboxRequest(), deps)).toEqual({
      status: 500,
      body: { error: 'mail_failed' },
    });
  });

  it('reports an answer it cannot read as a server error', async () => {
    const { deps } = makeDeps({
      openInbox: async () => ({ data: { outcome: 'opened' }, error: null }),
    });

    expect(await handleResolveMail(inboxRequest(), deps)).toEqual({
      status: 500,
      body: { error: 'mail_failed' },
    });
  });

  it('turns away a request without a password, asking nobody', async () => {
    const { deps, openInbox } = makeDeps();
    const passwordless = signRequest(BOB, 'resolveMail', { op: 'list', handle: 'neo' });

    expect(await handleResolveMail(passwordless, deps)).toEqual({
      status: 400,
      body: { error: 'payload_invalid' },
    });
    expect(openInbox).not.toHaveBeenCalled();
  });

  // The guesser is the key that signed, never a key the request names: a client naming
  // another player's key would spend that player's failures instead of its own.
  it('turns away a request that names a player key of its own, asking nobody', async () => {
    const { deps, openInbox } = makeDeps();

    const claiming = inboxRequest({ player_key: 'b'.repeat(64) });

    expect((await handleResolveMail(claiming, deps)).status).toBe(400);
    expect(openInbox).not.toHaveBeenCalled();
  });
});

describe('emailit.io opens one message, and marks it read', () => {
  const messageRequest = (fields: Record<string, unknown> = {}) =>
    inboxRequest({ op: 'read', number: 1, mark: true, ...fields });

  it('answers the message the number names', async () => {
    const { deps } = makeDeps();

    expect(await handleResolveMail(messageRequest(), deps)).toEqual({
      status: 200,
      body: { ok: true, message: WELCOME_OPENED },
    });
  });

  it('asks the store for that number with the md5 of the password, and lists nothing', async () => {
    const { deps, openMessage, openInbox } = makeDeps();

    await handleResolveMail(messageRequest({ number: 12 }), deps);

    expect(openMessage).toHaveBeenCalledWith({
      handle: 'neo',
      passwordMd5: md5('s3cret'),
      playerKey: BOB.publicKeyHex,
      number: 12,
      mark: true,
    });
    expect(openInbox).not.toHaveBeenCalled();
  });

  // A reply quotes the message it answers without reading it: only `read` marks.
  it('asks the store to leave the message unread when the request says so', async () => {
    const { deps, openMessage } = makeDeps();

    await handleResolveMail(messageRequest({ mark: false }), deps);

    expect(openMessage).toHaveBeenCalledWith(expect.objectContaining({ mark: false }));
  });

  it('turns away a request that does not say whether to mark the message read', async () => {
    const { deps, openMessage } = makeDeps();

    expect((await handleResolveMail(messageRequest({ mark: undefined }), deps)).status).toBe(400);
    expect(openMessage).not.toHaveBeenCalled();
  });

  it('says there is no such message when the inbox holds none by that number', async () => {
    const { deps } = makeDeps({
      openMessage: async () => ({ data: { outcome: 'no_message' }, error: null }),
    });

    expect(await handleResolveMail(messageRequest({ number: 7 }), deps)).toEqual({
      status: 404,
      body: { error: 'no_message' },
    });
  });

  it('says only that the login failed when the store does not open the inbox', async () => {
    const { deps } = makeDeps({
      openMessage: async () => ({ data: { outcome: 'login_failed' }, error: null }),
    });

    expect(await handleResolveMail(messageRequest(), deps)).toEqual({
      status: 401,
      body: { error: 'login_failed' },
    });
  });

  it('says the player must wait when the store is holding their guesses back', async () => {
    const { deps } = makeDeps({
      openMessage: async () => ({ data: { outcome: 'throttled' }, error: null }),
    });

    expect(await handleResolveMail(messageRequest(), deps)).toEqual({
      status: 429,
      body: { error: 'throttled' },
    });
  });

  it('opens nothing while emailit.io will not come up', async () => {
    const { deps, openMessage } = makeDeps({
      journal: [
        {
          path: '/boot/vmlinuz',
          content: null,
          owner: 'root',
          permissions: null,
          node_type: null,
          updated_at: '2026-10-15T09:00:00.000Z',
          writer_key: BOB.publicKeyHex,
        },
      ],
    });

    expect((await handleResolveMail(messageRequest(), deps)).status).toBe(404);
    expect(openMessage).not.toHaveBeenCalled();
  });

  it('reports an answer it cannot read as a server error', async () => {
    const { deps } = makeDeps({
      openMessage: async () => ({ data: { outcome: 'opened' }, error: null }),
    });

    expect(await handleResolveMail(messageRequest(), deps)).toEqual({
      status: 500,
      body: { error: 'mail_failed' },
    });
  });

  it.each([0, -1, 1.5, '1'])('turns away a message number of %o, asking nobody', async (number) => {
    const { deps, openMessage } = makeDeps();

    expect((await handleResolveMail(messageRequest({ number }), deps)).status).toBe(400);
    expect(openMessage).not.toHaveBeenCalled();
  });
});

describe('emailit.io delivers a message from whoever holds the password', () => {
  const sendRequest = (fields: Record<string, unknown> = {}) =>
    inboxRequest({ op: 'send', to: 'trin', subject: 'hello there', body: 'hi trin', ...fields });

  /** One character as a reader sees it, two UTF-16 units as JavaScript counts. */
  const EMOJI = String.fromCodePoint(0x1f600);

  it('answers that the message went', async () => {
    const { deps } = makeDeps();

    expect(await handleResolveMail(sendRequest(), deps)).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('hands the store the recipient, subject and body with the md5 of the password', async () => {
    const { deps, sendMessage, openInbox } = makeDeps();

    await handleResolveMail(sendRequest(), deps);

    expect(sendMessage).toHaveBeenCalledWith({
      handle: 'neo',
      passwordMd5: md5('s3cret'),
      playerKey: BOB.publicKeyHex,
      to: 'trin',
      subject: 'hello there',
      body: 'hi trin',
    });
    expect(openInbox).not.toHaveBeenCalled();
  });

  it.each([
    ['login_failed', 401],
    ['throttled', 429],
    ['no_mailbox', 404],
    ['mailbox_full', 409],
    ['send_limited', 429],
  ])('passes on a refusal of %s as %i', async (outcome, status) => {
    const { deps } = makeDeps({
      sendMessage: async () => ({ data: { outcome }, error: null }),
    });

    expect(await handleResolveMail(sendRequest(), deps)).toEqual({
      status,
      body: { error: outcome },
    });
  });

  it('delivers nothing while emailit.io will not come up', async () => {
    const { deps, sendMessage } = makeDeps({
      journal: [
        {
          path: '/boot/vmlinuz',
          content: null,
          owner: 'root',
          permissions: null,
          node_type: null,
          updated_at: '2026-10-15T09:00:00.000Z',
          writer_key: BOB.publicKeyHex,
        },
      ],
    });

    expect((await handleResolveMail(sendRequest(), deps)).status).toBe(404);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports a store it could not ask as a server error', async () => {
    const { deps } = makeDeps({
      sendMessage: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveMail(sendRequest(), deps)).toEqual({
      status: 500,
      body: { error: 'mail_failed' },
    });
  });

  it('reports an answer it cannot read as a server error', async () => {
    const { deps } = makeDeps({
      sendMessage: async () => ({ data: { outcome: 'delivered' }, error: null }),
    });

    expect((await handleResolveMail(sendRequest(), deps)).status).toBe(500);
  });

  it.each([
    ['an 80-character subject', { subject: EMOJI.repeat(80) }],
    ['a 4,000-character body', { body: EMOJI.repeat(4000) }],
  ])('delivers %s, counting an emoji as one', async (_label, fields) => {
    const { deps, sendMessage } = makeDeps();

    expect((await handleResolveMail(sendRequest(fields), deps)).status).toBe(200);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    ['an 81-character subject', { subject: 'x'.repeat(81) }],
    ['a 4,001-character body', { body: 'x'.repeat(4001) }],
    ['no recipient', { to: '' }],
    ['no body', { body: undefined }],
  ])('turns away %s, asking nobody', async (_label, fields) => {
    const { deps, sendMessage } = makeDeps();

    expect(await handleResolveMail(sendRequest(fields), deps)).toEqual({
      status: 400,
      body: { error: 'payload_invalid' },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('emailit.io deletes a message for whoever holds the password', () => {
  const deleteRequest = (fields: Record<string, unknown> = {}) =>
    inboxRequest({ op: 'delete', number: 2, ...fields });

  it('answers that the message is gone', async () => {
    const { deps } = makeDeps();

    expect(await handleResolveMail(deleteRequest(), deps)).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('asks the store for that number with the md5 of the password', async () => {
    const { deps, deleteMessage, openMessage } = makeDeps();

    await handleResolveMail(deleteRequest(), deps);

    expect(deleteMessage).toHaveBeenCalledWith({
      handle: 'neo',
      passwordMd5: md5('s3cret'),
      playerKey: BOB.publicKeyHex,
      number: 2,
    });
    expect(openMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['no_message', 404],
    ['login_failed', 401],
    ['throttled', 429],
  ])('passes on a refusal of %s as %i', async (outcome, status) => {
    const { deps } = makeDeps({
      deleteMessage: async () => ({ data: { outcome }, error: null }),
    });

    expect(await handleResolveMail(deleteRequest(), deps)).toEqual({
      status,
      body: { error: outcome },
    });
  });

  it('reports an answer it cannot read as a server error', async () => {
    const { deps } = makeDeps({
      deleteMessage: async () => ({ data: { outcome: 'opened' }, error: null }),
    });

    expect((await handleResolveMail(deleteRequest(), deps)).status).toBe(500);
  });

  it('reports a store it could not ask as a server error', async () => {
    const { deps } = makeDeps({
      deleteMessage: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect((await handleResolveMail(deleteRequest(), deps)).status).toBe(500);
  });

  it.each([0, 1.5, '2'])('turns away a message number of %o, asking nobody', async (number) => {
    const { deps, deleteMessage } = makeDeps();

    expect((await handleResolveMail(deleteRequest({ number }), deps)).status).toBe(400);
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});

describe('emailit.io is told what is wanted', () => {
  it('turns away a request that names no op, asking nobody', async () => {
    const { deps, openInbox } = makeDeps();
    const unnamed = signRequest(BOB, 'resolveMail', { handle: 'neo', password: 's3cret' });

    expect((await handleResolveMail(unnamed, deps)).status).toBe(400);
    expect(openInbox).not.toHaveBeenCalled();
  });
});
