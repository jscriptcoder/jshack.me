import { describe, expect, it } from 'vitest';
import {
  ALL_ESSIDS,
  deepBoxes,
  filesUnder,
  gatewaysOn,
  lanBoxes,
} from '../../test/worldContent.js';
import { createPatchApi } from '../../adapters/patchApi.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { signedEnvelopeSchema } from '../signedRequest/types.js';
import { asAbsPath, asMachineId } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import { buildRemoteHostFs } from './remoteHostFs.js';
import { buildDeepHostFs } from './deepHostFs.js';
import { buildFixedSiteFs } from './fixedSiteFs.js';
import { FIXED_SITES } from './fixedSites.js';

/** Every tree the world generates: each machine on a home LAN and below it, each
 *  gateway, and each fixed site, labelled by where it stands. */
const everyGeneratedTree = (): readonly (readonly [string, Directory])[] => [
  ...lanBoxes(ALL_ESSIDS).map(
    (box) => [`${box.essid} ${box.host.ip}`, buildRemoteHostFs(box.essid, box.host)] as const,
  ),
  ...deepBoxes(ALL_ESSIDS).map(
    (box) => [`${box.essid} ${box.host.ip}`, buildDeepHostFs(box.essid, box.host)] as const,
  ),
  ...gatewaysOn(ALL_ESSIDS).map((gateway) => [gateway.name, gateway.tree] as const),
  ...FIXED_SITES.map((site) => [site.domain, buildFixedSiteFs(site)] as const),
];

describe('what a player can carry home', () => {
  // The sample sweep, like every content test: one rare box holding one large file
  // breaks the claim, so a PR touching generated content runs it with WORLD_SWEEP=full.
  it('fits every generated file into the one signed write that saves it on the player box', async () => {
    const identity = generateIdentity();
    const sent: string[] = [];
    const patches = createPatchApi({
      identity,
      machineId: asMachineId(computeWorkstationId('deskbox', identity.publicKeyHex)),
      owner: 'operator',
      tier: 'user',
      fetchImpl: async (_url, init) => {
        sent.push(String(init?.body));
        return new Response('{}', { status: 200 });
      },
    });
    // Root reads every file a box holds, so every file is one somebody may carry.
    // The write's size is what the transport limits, and a file's escaped length is
    // what decides it, so the files hardest to carry are the ones sent.
    const hardest = everyGeneratedTree()
      .flatMap(([box, tree]) =>
        [...filesUnder(tree)].map(([path, content]) => ({
          label: `${box} /${path}`,
          path,
          content,
        })),
      )
      .sort(
        (one, other) => JSON.stringify(other.content).length - JSON.stringify(one.content).length,
      )
      .slice(0, 20);

    for (const { path, content } of hardest) {
      await patches.write(asAbsPath(`/home/operator/${path.split('/').pop() ?? ''}`), content, {
        isNew: true,
      });
    }
    expect(sent).toHaveLength(hardest.length);
    sent.forEach((body, index) => {
      expect(
        signedEnvelopeSchema.safeParse(JSON.parse(body)).success,
        `${hardest[index]?.label}: ${JSON.stringify(hardest[index]?.content).length} escaped`,
      ).toBe(true);
    });
  });
});
