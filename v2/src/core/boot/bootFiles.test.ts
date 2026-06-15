import { describe, expect, it } from 'vitest';
import { canBoot } from './bootFiles';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';

/**
 * `canBoot` is the single pure authority for "can this machine come up?": a box
 * boots only when both kernel images — `/boot/vmlinuz` and `/boot/initrd.img` —
 * are present in its (already patch-replayed) filesystem. A root `rm` of either
 * leaves a tombstone in the shared journal, so the replayed tree is missing the
 * file and the box is permanently bricked. The boot screen renders the decision;
 * the decision lives here. Ordering matters: GRUB loads the kernel first, so when
 * both are gone the panic must name `vmlinuz` (the first thing the loader seeks).
 */

const withBootFiles = (files: Readonly<Record<string, ReturnType<typeof buildFile>>>) =>
  buildDirectory({ boot: buildDirectory(files, { owner: 'root' }) });

describe('canBoot', () => {
  it('boots when both /boot/vmlinuz and /boot/initrd.img are present', () => {
    const root = withBootFiles({
      vmlinuz: buildFile('bzImage, version 5.15.0-91-generic'),
      'initrd.img': buildFile('initramfs image, version 5.15.0-91-generic'),
    });

    expect(canBoot(root)).toEqual({ ok: true });
  });

  it('fails to boot, naming vmlinuz, when /boot/vmlinuz has been removed', () => {
    const root = withBootFiles({ 'initrd.img': buildFile('initramfs image') });

    expect(canBoot(root)).toEqual({ ok: false, missing: 'vmlinuz' });
  });

  it('fails to boot, naming initrd.img, when only the kernel remains', () => {
    const root = withBootFiles({ vmlinuz: buildFile('bzImage') });

    expect(canBoot(root)).toEqual({ ok: false, missing: 'initrd.img' });
  });

  it('names vmlinuz first when both boot files are gone', () => {
    const root = withBootFiles({});

    expect(canBoot(root)).toEqual({ ok: false, missing: 'vmlinuz' });
  });

  it('fails to boot when the entire /boot directory is gone', () => {
    const root = buildDirectory({});

    expect(canBoot(root)).toEqual({ ok: false, missing: 'vmlinuz' });
  });

  it('fails to boot when /boot has been clobbered into a file', () => {
    // Root can write `/boot` itself (write+execute on `/`); a regular file there
    // is not a bootable directory, so the box is bricked all the same.
    const root = buildDirectory({ boot: buildFile('not a directory') });

    expect(canBoot(root)).toEqual({ ok: false, missing: 'vmlinuz' });
  });
});
