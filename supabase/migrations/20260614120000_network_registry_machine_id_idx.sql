-- Story 2 slice 2c (cross-player READ): resolveCrossPlayerFs reverse-looks-up the
-- registry by the workstation's machine id (B holds it from the 2b ssh session). The
-- table's PK is public_ip, so without this index that lookup is a full scan. Index it.
create index if not exists network_registry_workstation_machine_id_idx
  on network_registry (workstation_machine_id);
