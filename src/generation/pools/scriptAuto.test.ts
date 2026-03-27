import { describe, it, expect } from 'vitest';
import { scriptAutoTemplatesByRole } from './scriptAuto';
import type { MachineRole } from '../types';

const allRoles: readonly MachineRole[] = [
  'fileserver',
  'database',
  'webserver',
  'workstation',
  'mailserver',
  'iot',
  'router',
  'switch',
];

describe('scriptAutoTemplatesByRole', () => {
  it('has templates for every machine role', () => {
    for (const role of allRoles) {
      expect(scriptAutoTemplatesByRole[role].length).toBeGreaterThan(0);
    }
  });

  it('each template has valid location', () => {
    const validLocations = ['cron.d', 'init.d', 'if-up.d'];
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        expect(validLocations).toContain(template.location);
      }
    }
  });

  it('each template has valid flavor', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        expect(['local', 'remote']).toContain(template.flavor);
      }
    }
  });

  it('each template has a script name ending in .js', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        expect(template.scriptName).toMatch(/\.js$/);
      }
    }
  });

  it('each template has non-empty instructions, dataFileName, extractField, expectedChecksum', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        expect(template.instructions.length).toBeGreaterThan(0);
        expect(template.dataFileName.length).toBeGreaterThan(0);
        expect(template.extractField.length).toBeGreaterThan(0);
        expect(template.expectedChecksum.length).toBeGreaterThan(0);
      }
    }
  });

  it('each template has non-empty dataContent that is valid JSON', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        expect(template.dataContent.length).toBeGreaterThan(0);
        expect(() => JSON.parse(template.dataContent)).not.toThrow();
      }
    }
  });

  it('expectedChecksum matches the correct extraction from dataContent', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        const data = JSON.parse(template.dataContent);
        // extractField supports dot notation for nested fields
        const fields = template.extractField.split('.');
        let value: unknown = data;
        for (const field of fields) {
          value = (value as Record<string, unknown>)[field];
        }
        expect(String(value)).toBe(template.expectedChecksum);
      }
    }
  });

  it('instructions contain the extractField name', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        // The instructions should mention which field to extract
        const lastField = template.extractField.split('.').pop()!;
        expect(template.instructions).toContain(lastField);
      }
    }
  });

  it('local templates reference a data file path, remote templates reference an API endpoint', () => {
    for (const role of allRoles) {
      for (const template of scriptAutoTemplatesByRole[role]) {
        if (template.flavor === 'local') {
          expect(template.dataFileName).toMatch(/^\//);
        } else {
          // Remote: just a filename (endpoint name), not a full path
          expect(template.dataFileName).not.toMatch(/^\//);
        }
      }
    }
  });

  it('has a mix of local and remote templates across all roles', () => {
    const allTemplates = allRoles.flatMap((role) => scriptAutoTemplatesByRole[role]);
    const locals = allTemplates.filter((t) => t.flavor === 'local');
    const remotes = allTemplates.filter((t) => t.flavor === 'remote');
    expect(locals.length).toBeGreaterThan(0);
    expect(remotes.length).toBeGreaterThan(0);
  });

  it('has a mix of all three locations across all roles', () => {
    const allTemplates = allRoles.flatMap((role) => scriptAutoTemplatesByRole[role]);
    const locations = new Set(allTemplates.map((t) => t.location));
    expect(locations).toContain('cron.d');
    expect(locations).toContain('init.d');
    expect(locations).toContain('if-up.d');
  });
});
