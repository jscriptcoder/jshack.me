-- Seed: the techparts.io themed network. Single-machine world network
-- with theme='techparts' that the generator registry maps to
-- generateTechpartsNetwork. Lives at 198.51.100.80 (TEST-NET-2 docs
-- range — separate /24 from findit @ 192.0.2.80 and playground @
-- 203.0.113.42 so the three read as distinct parts of the public
-- internet; the .80 octet nods at port 80).
--
-- techparts.io is a hand-authored gray-market electronics reseller site.
-- Ports 80/443 are open and read-only at boot; the Apache/2.4.49 banner
-- on port 80 lines up with the CVE-2024-9001 template in
-- src/generation/pools/vulnerabilities.ts so the site becomes
-- exploitable (and cross-player tamperable) once the activation
-- timeline elapses. No request handler — the static-file curl pipeline
-- handles every URL.
--
-- search_metadata lets findit.io index this site automatically on the
-- next page-load regenerate. No code change is required.

INSERT INTO public_ips (ip, kind, owner_key)
  VALUES ('198.51.100.80', 'world_network', NULL);

INSERT INTO world_networks (public_ip, seed, name, description, theme, public_domain, search_metadata)
  VALUES (
    '198.51.100.80',
    'techparts',
    'techparts.io',
    'Gray-market electronics reseller. OEM, refurbished, and salvage components — worldwide shipping, no questions asked.',
    'techparts',
    'techparts.io',
    jsonb_build_object(
      'title', 'TechParts Global — Worldwide Electronic Components',
      'description', 'OEM, refurbished, and bulk electronics. Factory-direct pricing, worldwide shipping.',
      'keywords', jsonb_build_array('electronics', 'components', 'cpu', 'memory', 'wholesale', 'oem', 'parts')
    )
  );
