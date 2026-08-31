BEGIN;
INSERT INTO providers (id,name,hq_country,hq_city,origin,provider_type,is_local_asean,website,legal_country,legal_note) VALUES ('leyun_asia','Leyun Cloud','Malaysia',NULL,'local','IaaS',TRUE,'https://www.leyun.asia/','Malaysia',NULL) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, hq_country=EXCLUDED.hq_country, hq_city=EXCLUDED.hq_city, origin=EXCLUDED.origin, provider_type=EXCLUDED.provider_type, is_local_asean=EXCLUDED.is_local_asean, website=EXCLUDED.website, legal_country=EXCLUDED.legal_country, legal_note=EXCLUDED.legal_note;
INSERT INTO stacks (provider_id, hypervisor, orchestration, storage, container_runtime, control_plane, source_url) VALUES ('leyun_asia',NULL,NULL,NULL,NULL,NULL,'https://www.leyun.asia/') ON CONFLICT (provider_id) DO UPDATE SET hypervisor=EXCLUDED.hypervisor, orchestration=EXCLUDED.orchestration, storage=EXCLUDED.storage, container_runtime=EXCLUDED.container_runtime, control_plane=EXCLUDED.control_plane, source_url=EXCLUDED.source_url;
INSERT INTO sovereignty (provider_id, data_residency) VALUES ('leyun_asia','local') ON CONFLICT (provider_id) DO UPDATE SET data_residency=EXCLUDED.data_residency;
DELETE FROM sources WHERE provider_id = 'leyun_asia';
INSERT INTO sources (provider_id, url, scraped_at, status) VALUES ('leyun_asia','https://www.leyun.asia/', now(), 'OK');
INSERT INTO locations (city, country) VALUES ('Undisclosed','Malaysia') ON CONFLICT (city, country) DO NOTHING;
INSERT INTO provider_locations (provider_id, location_id) SELECT 'leyun_asia', id FROM locations WHERE city='Undisclosed' AND country='Malaysia' ON CONFLICT DO NOTHING;
COMMIT;
