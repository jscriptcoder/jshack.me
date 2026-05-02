-- public_domain: optional FQDN for themed networks. findit.io needs
-- this so its router hostname is the full domain ('findit.io') rather
-- than the mission generator's gw01-style names. Other rows (e.g.,
-- playground) leave it NULL — they're not visited by domain.
--
-- Future themed nets (techparts.io, devnotes.io, ...) will set this.
-- The findit.io search-engine generator pairs each indexable row's
-- search_metadata with its public_domain to build /etc/findit/index.json.

ALTER TABLE world_networks
  ADD COLUMN public_domain TEXT;

-- Seed: the findit.io search engine. Single-machine themed network
-- with theme='search-engine' that the request-handler registry maps
-- to searchEngineHandler. Lives at 192.0.2.80 (TEST-NET-1 docs range,
-- intentionally in a different /24 from the playground so the two
-- read as separate parts of the internet rather than adjacent rows
-- in a debug pool — port 80 nods to the HTTP service).

INSERT INTO public_ips (ip, kind, owner_key)
  VALUES ('192.0.2.80', 'world_network', NULL);

INSERT INTO world_networks (public_ip, seed, name, description, theme, public_domain, search_metadata)
  VALUES (
    '192.0.2.80',
    'findit-basic',
    'findit.io',
    'Search engine for the public web — index of every themed network in the world.',
    'search-engine',
    'findit.io',
    jsonb_build_object(
      'title', 'findit.io',
      'description', 'Search engine for the public web. Use ?q=keyword to find sites.',
      'keywords', jsonb_build_array('search', 'find', 'engine', 'directory', 'index')
    )
  );
