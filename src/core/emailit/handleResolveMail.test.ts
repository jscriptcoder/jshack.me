import { describe, expect, it, vi } from 'vitest';
import { generateIdentity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import { computeApGatewayId } from '../identity/router.js';
import { EMAILIT_DOMAIN, EMAILIT_NETWORK } from '../generation/fixedSites.js';
import { siteAddress } from '../generation/publisher.js';
import { md5 } from '../generation/md5.js';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs.js';
import { handleResolveMail, type OpenInbox, type ResolveMailDeps } from './handleResolveMail.js';

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

/** emailit.io's box as the world generates it, with `journal` written over it. */
const makeDeps = (
  over: { readonly openInbox?: OpenInbox; readonly journal?: readonly OwnerPatchRow[] } = {},
) => {
  const openInbox = vi.fn(
    over.openInbox ??
      (async () => ({ data: { outcome: 'opened', messages: [WELCOME] }, error: null })),
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
  };
  return { deps, openInbox, findNetworkByPublicIp };
};

const inboxRequest = (fields: Record<string, unknown> = {}) =>
  signRequest(BOB, 'resolveMail', { handle: 'neo', password: 's3cret', ...fields });

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
    const passwordless = signRequest(BOB, 'resolveMail', { handle: 'neo' });

    expect((await handleResolveMail(passwordless, deps)).status).toBe(400);
    expect(openInbox).not.toHaveBeenCalled();
  });
});
