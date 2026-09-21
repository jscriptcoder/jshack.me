import { describe, expect, it } from 'vitest';
import { inhabitant, networkPersona } from './persona';
import type { LanHost } from './generateHomeLan';
import { NETWORK_CATEGORIES } from './pools/essidCatalog';

/**
 * Who a network belongs to. Every machine behind an access point reads as part of one
 * place — an office, a café, a flat — so what its people write names that place, and
 * signs with addresses on the network's own domain.
 */

describe('networkPersona', () => {
  it('knows a catalog network by its kind of place and its own name for itself', () => {
    expect(networkPersona('WAYSTAR-WIFI')).toEqual({
      category: 'corporate',
      place: 'Waystar Royco',
      domain: 'waystar-wifi.lan',
    });
    expect(networkPersona('NIGHT-OWL-CAFE')).toMatchObject({
      category: 'cafe',
      place: 'the Night Owl',
    });
    expect(networkPersona('NULL-BYTE')).toMatchObject({ category: 'hacker' });
  });

  it('gives a network outside the catalog a place of its own, the same one every time', () => {
    const persona = networkPersona('Linksys-Kitchen');

    expect(NETWORK_CATEGORIES).toContain(persona.category);
    expect(persona.domain).toBe('linksys-kitchen.lan');
    expect(persona.place).not.toBe('');
    expect(networkPersona('Linksys-Kitchen')).toEqual(persona);
  });

  it('does not put every network outside the catalog in the same kind of place', () => {
    const categories = new Set(
      Array.from({ length: 40 }, (_unused, index) => networkPersona(`Uncatalogued-${index}`).category),
    );

    expect(categories.size).toBeGreaterThan(3);
  });
});

const desktopAt = (octet: number): LanHost => ({
  ip: `192.168.40.${octet}`,
  hostname: `desktop-${octet}`,
  kind: 'machine',
});

describe('inhabitant', () => {
  it('reads a person out of an account named for them', () => {
    const person = inhabitant({ essid: 'ACME-CORP', host: desktopAt(12), username: 'mrodriguez' });

    expect(person.fullName).toMatch(/^M[a-z]+ Rodriguez$/);
    expect(person.email).toBe('mrodriguez@acme-corp.lan');
  });

  it('keeps a short surname whole', () => {
    expect(
      inhabitant({ essid: 'ACME-CORP', host: desktopAt(12), username: 'klee' }).fullName,
    ).toMatch(/^K[a-z]+ Lee$/);
  });

  it('gives an account named for a job a person of its own', () => {
    const person = inhabitant({ essid: 'SUITE-401', host: desktopAt(30), username: 'developer' });

    expect(person.fullName).toMatch(/^[A-Z][a-z-]+ [A-Z][A-Za-z'-]+$/);
    expect(person.email).toBe('developer@suite-401.lan');
  });

  it('is one person every time the box is read', () => {
    const read = () => inhabitant({ essid: 'SUITE-401', host: desktopAt(30), username: 'jsmith' });

    expect(read()).toEqual(read());
  });

  it('puts different people behind the same account name on different boxes', () => {
    const names = new Set(
      Array.from(
        { length: 30 },
        (_unused, index) =>
          inhabitant({ essid: 'ACME-CORP', host: desktopAt(index + 2), username: 'jsmith' }).fullName,
      ),
    );

    expect(names.size).toBeGreaterThan(3);
  });
});
