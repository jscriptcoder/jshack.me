import { describe, it, expect } from 'vitest';
import {
  crossMachineCredentialLeakTemplates,
  webCredentialTemplates,
  httpEntryCredentialTemplates,
} from './credentials';

describe('crossMachineCredentialLeakTemplates', () => {
  it('should have at least 10 templates', () => {
    expect(crossMachineCredentialLeakTemplates.length).toBeGreaterThanOrEqual(10);
  });

  it('every template should have a path starting with /', () => {
    for (const t of crossMachineCredentialLeakTemplates) {
      expect(t.path).toMatch(/^\//);
    }
  });

  it('every template should have {{target_ip}} placeholder in content', () => {
    for (const t of crossMachineCredentialLeakTemplates) {
      expect(t.content).toContain('{{target_ip}}');
    }
  });

  it('every template should have {{target_username}} placeholder in content', () => {
    for (const t of crossMachineCredentialLeakTemplates) {
      expect(t.content).toContain('{{target_username}}');
    }
  });

  it('every template should have {{target_password}} placeholder in content', () => {
    for (const t of crossMachineCredentialLeakTemplates) {
      expect(t.content).toContain('{{target_password}}');
    }
  });

  it('every template should have owner of root or user', () => {
    for (const t of crossMachineCredentialLeakTemplates) {
      expect(['root', 'user']).toContain(t.owner);
    }
  });

  it('should have unique paths', () => {
    const paths = crossMachineCredentialLeakTemplates.map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('webCredentialTemplates', () => {
  it('should have at least 8 templates', () => {
    expect(webCredentialTemplates.length).toBeGreaterThanOrEqual(8);
  });

  it('every template should have a webPath', () => {
    for (const t of webCredentialTemplates) {
      expect(t.webPath.length).toBeGreaterThan(0);
    }
  });

  it('body-based templates should have {{username}} and {{password}} placeholders', () => {
    const bodyTemplates = webCredentialTemplates.filter((t) => !t.sidecarHeader);
    expect(bodyTemplates.length).toBeGreaterThan(0);
    for (const t of bodyTemplates) {
      expect(t.content).toContain('{{username}}');
      expect(t.content).toContain('{{password}}');
    }
  });

  it('header-based templates should have a sidecarHeader', () => {
    const headerTemplates = webCredentialTemplates.filter((t) => t.sidecarHeader);
    expect(headerTemplates.length).toBeGreaterThan(0);
    for (const t of headerTemplates) {
      expect(t.sidecarHeader!.length).toBeGreaterThan(0);
    }
  });

  it('should have unique webPaths', () => {
    const paths = webCredentialTemplates.map((t) => t.webPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('should not duplicate paths from httpEntryCredentialTemplates', () => {
    // Web credential templates are for non-entry machines, so paths should be distinct
    // to avoid confusion. Some overlap is acceptable if they serve different purposes,
    // but let's keep them unique for clarity.
    const entryPaths = new Set(httpEntryCredentialTemplates.map((t) => t.webPath));
    for (const t of webCredentialTemplates) {
      expect(entryPaths.has(t.webPath)).toBe(false);
    }
  });
});
