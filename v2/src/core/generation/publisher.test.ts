import { describe, expect, it } from 'vitest';
import { ESSID_CATALOG } from './pools/essidCatalog';
import { createPrng } from './prng';
import { generatePublicIp, isPublicIp } from './ip';
import { publisherAt, publisherIp, publisherSite } from './publisher';

/**
 * The institutions of the world publish a website: every office, café, the university
 * and the city's public places. Homes, gadgets and hacker hangouts never do. Each site
 * has a domain of its own, so no two institutions answer to the same name.
 */

const PUBLISHED_SITES: Readonly<Record<string, { domain: string; name: string }>> = {
  'ACME-CORP': { domain: 'acme.com', name: 'Acme Corporation' },
  'INITECH-5G': { domain: 'initech.com', name: 'Initech' },
  'GLOBEX-NET': { domain: 'globex.com', name: 'Globex Corporation' },
  'WAYSTAR-WIFI': { domain: 'waystar.com', name: 'Waystar Royco' },
  'DUNDER-LAN': { domain: 'dundermifflin.com', name: 'Dunder Mifflin' },
  'HOOLI-SEC': { domain: 'hooli.com', name: 'Hooli' },
  'UMBRELLA-NET': { domain: 'umbrellacorp.com', name: 'Umbrella Corporation' },
  'STARK-WIFI': { domain: 'starkindustries.com', name: 'Stark Industries' },
  'CYBERDYNE-5G': { domain: 'cyberdyne.com', name: 'Cyberdyne Systems' },
  'OSCORP-GUEST': { domain: 'oscorp.com', name: 'Oscorp' },
  'WEYLAND-NET': { domain: 'weyland-yutani.com', name: 'Weyland-Yutani' },
  'TYRELL-CORP': { domain: 'tyrellcorp.com', name: 'Tyrell Corporation' },
  'APERTURE-WIFI': { domain: 'aperturescience.com', name: 'Aperture Science' },
  'SHINRA-5G': { domain: 'shinra.com', name: 'Shinra Electric' },
  'ABSTERGO-NET': { domain: 'abstergo.com', name: 'Abstergo Industries' },
  'WONKA-LABS': { domain: 'wonkalabs.com', name: 'Wonka Labs' },
  'OMNI-CORP': { domain: 'ocp.com', name: 'Omni Consumer Products' },
  'PIED-PIPER': { domain: 'piedpiper.com', name: 'Pied Piper' },
  'VANDELAY-INDUSTRIES': { domain: 'vandelayindustries.com', name: 'Vandelay Industries' },
  'NAKATOMI-PLAZA': { domain: 'nakatomi.com', name: 'Nakatomi Trading' },
  'BREW-AND-CODE': { domain: 'brewandcode.com', name: 'Brew & Code' },
  'BEAN-THERE-WIFI': { domain: 'beanthere.com', name: 'Bean There' },
  'MIDNIGHT-DINER': { domain: 'midnightdiner.com', name: 'the Midnight Diner' },
  'NIGHT-OWL-CAFE': { domain: 'nightowlcafe.com', name: 'the Night Owl' },
  'GROUND-ZERO-COFFEE': { domain: 'groundzerocoffee.com', name: 'Ground Zero Coffee' },
  'ESPRESSO-EXPRESS': { domain: 'espressoexpress.com', name: 'Espresso Express' },
  'CAMPUS-GUEST-OPEN': { domain: 'ridgemont.edu', name: 'Ridgemont University' },
  'LIBRARY-PATRON': { domain: 'ridgemontlibrary.org', name: 'Ridgemont Public Library' },
  'CITY-PARK-WIFI': { domain: 'ridgemontparks.gov', name: 'Ridgemont Parks Department' },
  'METRO-COMMUTER': { domain: 'ridgemontmetro.gov', name: 'Ridgemont Metro' },
  'AIRPORT-LOUNGE-VIP': { domain: 'flyridgemont.com', name: 'Ridgemont International Airport' },
  'TRAIN-STATION-FREE': { domain: 'ridgemontcentral.org', name: 'Ridgemont Central Station' },
};

describe('publisherSite', () => {
  it('gives every institution its own website', () => {
    const sites = Object.fromEntries(
      ESSID_CATALOG.flatMap((entry) => {
        const site = publisherSite(entry.essid);
        return site === undefined ? [] : [[entry.essid, site]];
      }),
    );

    expect(sites).toEqual(PUBLISHED_SITES);
    const domains = Object.values(sites).map((site) => site.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('publishes nothing for a home, a gadget or a hacker hangout', () => {
    expect(publisherSite('APT-3B-WIFI')).toBeUndefined();
    expect(publisherSite('SMART-FRIDGE-NET')).toBeUndefined();
    expect(publisherSite('NULL-BYTE')).toBeUndefined();
  });

  it('publishes nothing for a network outside the catalog', () => {
    expect(publisherSite('Linksys-Kitchen')).toBeUndefined();
  });
});

describe('publisherIp', () => {
  it('gives every institution a public address of its own', () => {
    const addresses = Object.keys(PUBLISHED_SITES).map((essid) => publisherIp(essid));

    expect(new Set(addresses).size).toBe(addresses.length);
    for (const address of addresses) {
      expect(address).toMatch(/^193\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      expect(isPublicIp(address ?? '')).toBe(true);
    }
  });

  it('is the same address every time it is asked', () => {
    expect(publisherIp('CAMPUS-GUEST-OPEN')).toBe(publisherIp('CAMPUS-GUEST-OPEN'));
  });

  it('gives a network that publishes nothing no address', () => {
    expect(publisherIp('APT-3B-WIFI')).toBeUndefined();
    expect(publisherIp('Linksys-Kitchen')).toBeUndefined();
  });

  it('never hands a publisher address to a network that joins the internet', () => {
    for (let seed = 0; seed < 2000; seed++) {
      expect(generatePublicIp(createPrng(`join-${seed}`))).not.toMatch(/^193\./);
    }
  });
});

describe('publisherAt', () => {
  it('finds the institution behind every published address', () => {
    for (const essid of Object.keys(PUBLISHED_SITES)) {
      expect(publisherAt(publisherIp(essid) ?? '')).toBe(essid);
    }
  });

  it('finds nobody behind an address no institution publishes at', () => {
    expect(publisherAt('193.0.0.1')).toBeUndefined();
    expect(publisherAt('45.12.34.56')).toBeUndefined();
    expect(publisherAt('ridgemont.edu')).toBeUndefined();
  });
});
