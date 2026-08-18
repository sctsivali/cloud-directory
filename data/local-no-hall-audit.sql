BEGIN;

INSERT INTO locations (city, country) VALUES
  ('Hanoi','Vietnam'),
  ('Singapore','Singapore')
ON CONFLICT (city, country) DO NOTHING;

-- vietvps.net lists VPS Vietnam (Hanoi) and VPS Singapore (Tier 3, no hall name)
INSERT INTO provider_locations (provider_id, location_id)
SELECT v.pid, l.id
FROM (VALUES
  ('vietvps','Hanoi','Vietnam'),
  ('vietvps','Singapore','Singapore')
) AS v(pid, city, country)
JOIN locations l ON l.city = v.city AND l.country = v.country
ON CONFLICT DO NOTHING;

UPDATE tiers
SET dc_city = 'Hanoi', dc_location = 'Hanoi', dc_country = 'Vietnam'
WHERE provider_id = 'vietvps' AND status = 'OK';

-- Others stay undisclosed / city-only:
-- dewaweb, bizfly, vhost: cities already official, no hall name
-- jagoanhosting: Indonesia+Singapore on blog, no hall; Singapore location already linked
-- indonesian_cloud, hostvn, vietnap, 1vps_vietnam, server_connect, sitedotnet: no searchable hall

COMMIT;
