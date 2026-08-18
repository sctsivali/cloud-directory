BEGIN;

-- Existing named halls, first-party pages
INSERT INTO provider_buildings (provider_id, building_id) VALUES
  ('domainesia', 22), -- NEX Cyber 2 — domainesia.com/teknologi
  ('domainesia', 20), -- Menara Tendean — same
  ('domainesia', 9),  -- Cyber 1 / APJII — same
  ('ip_serverone', 8),  -- CJ1 Cyberjaya — ipserverone.com + KB
  ('ip_serverone', 19)  -- AIMS KL — kb.ipserverone.com
ON CONFLICT DO NOTHING;

-- Viettel official list: viettelidc.com.vn/tin-tuc/trung-tam-du-lieu
INSERT INTO buildings (name, city, country, listed, operator, source, address)
VALUES
  ('Viettel IDC Hòa Lạc', 'Hanoi', 'Vietnam', TRUE, 'Viettel IDC',
   'https://viettelidc.com.vn/tin-tuc/trung-tam-du-lieu',
   'Khu Công nghệ cao Hòa Lạc, Km29, Đại lộ Thăng Long, Hà Nội'),
  ('Viettel IDC Pháp Vân', 'Hanoi', 'Vietnam', TRUE, 'Viettel IDC',
   'https://viettelidc.com.vn/tin-tuc/trung-tam-du-lieu', NULL),
  ('Viettel IDC Bình Dương', 'Binh Duong', 'Vietnam', TRUE, 'Viettel IDC',
   'https://viettelidc.com.vn/tin-tuc/trung-tam-du-lieu', NULL),
  ('Viettel IDC Đà Nẵng', 'Da Nang', 'Vietnam', TRUE, 'Viettel IDC',
   'https://viettelidc.com.vn/tin-tuc/trung-tam-du-lieu', NULL)
ON CONFLICT (name, city, country) DO NOTHING;

INSERT INTO provider_buildings (provider_id, building_id)
SELECT 'viettel_idc', id FROM buildings
WHERE name IN (
  'Viettel IDC Hòa Lạc','Viettel IDC Pháp Vân',
  'Viettel IDC Bình Dương','Viettel IDC Đà Nẵng',
  'Viettel IDC Hoa Tham','Viettel IDC Phu Trung (Tan Phu Trung IP)'
)
ON CONFLICT DO NOTHING;

INSERT INTO locations (city, country) VALUES
  ('Jakarta','Indonesia'),
  ('Singapore','Singapore'),
  ('San Jose','United States'),
  ('Hanoi','Vietnam'),
  ('Ho Chi Minh City','Vietnam'),
  ('Da Nang','Vietnam'),
  ('Binh Duong','Vietnam'),
  ('Cyberjaya','Malaysia'),
  ('Kuala Lumpur','Malaysia'),
  ('Cikarang','Indonesia'),
  ('Sentul','Indonesia'),
  ('Serpong','Indonesia'),
  ('Surabaya','Indonesia')
ON CONFLICT (city, country) DO NOTHING;

INSERT INTO provider_locations (provider_id, location_id)
SELECT v.pid, l.id
FROM (VALUES
  ('dewaweb','Jakarta','Indonesia'),
  ('dewaweb','Singapore','Singapore'),
  ('dewaweb','San Jose','United States'),
  ('domainesia','Jakarta','Indonesia'),
  ('jagoanhosting','Singapore','Singapore'),
  ('bizfly_cloud','Hanoi','Vietnam'),
  ('bizfly_cloud','Ho Chi Minh City','Vietnam'),
  ('ip_serverone','Cyberjaya','Malaysia'),
  ('ip_serverone','Kuala Lumpur','Malaysia'),
  ('viettel_idc','Hanoi','Vietnam'),
  ('viettel_idc','Ho Chi Minh City','Vietnam'),
  ('viettel_idc','Da Nang','Vietnam'),
  ('viettel_idc','Binh Duong','Vietnam'),
  ('vhost_vietnam','Hanoi','Vietnam'),
  ('vhost_vietnam','Ho Chi Minh City','Vietnam'),
  ('vhost_vietnam','Singapore','Singapore'),
  ('telkomsigma_cloud','Cikarang','Indonesia'),
  ('telkomsigma_cloud','Sentul','Indonesia'),
  ('telkomsigma_cloud','Serpong','Indonesia'),
  ('telkomsigma_cloud','Surabaya','Indonesia')
) AS v(pid, city, country)
JOIN locations l ON l.city = v.city AND l.country = v.country
ON CONFLICT DO NOTHING;

-- Restore package cities only when that city is on the official site
UPDATE tiers SET dc_city='Jakarta', dc_location='Jakarta', dc_country='Indonesia'
WHERE provider_id='dewaweb' AND status='OK';

UPDATE tiers SET dc_city='Jakarta', dc_location='Jakarta', dc_country='Indonesia'
WHERE provider_id='domainesia' AND status='OK';

UPDATE tiers SET dc_city='Hanoi', dc_location='Hanoi', dc_country='Vietnam'
WHERE provider_id='bizfly_cloud' AND status='OK';

UPDATE tiers SET dc_city='Cyberjaya', dc_location='Cyberjaya', dc_country='Malaysia'
WHERE provider_id='ip_serverone' AND status='OK';

UPDATE tiers SET dc_city='Hanoi', dc_location='Hanoi', dc_country='Vietnam'
WHERE provider_id='viettel_idc' AND status='OK';

UPDATE tiers SET dc_city='Ho Chi Minh City', dc_location='Ho Chi Minh City', dc_country='Vietnam'
WHERE provider_id='vhost_vietnam' AND status='OK';

-- Still no searchable hall/city: keep undisclosed
-- jagoanhosting, indonesian_cloud, hostvn, vietnap, vietvps, 1vps_vietnam,
-- server_connect, sitedotnet, telkomsigma packages (Jakarta was not the hall name)

COMMIT;

SELECT p.id, p.name,
       COUNT(DISTINCT pb.building_id) halls,
       COUNT(DISTINCT pl.location_id) cities,
       COUNT(t.id) FILTER (WHERE t.status='OK' AND t.dc_city='Undisclosed') undisc,
       COUNT(t.id) FILTER (WHERE t.status='OK' AND t.dc_city<>'Undisclosed') named
FROM providers p
LEFT JOIN provider_buildings pb ON pb.provider_id=p.id
LEFT JOIN provider_locations pl ON pl.provider_id=p.id
LEFT JOIN tiers t ON t.provider_id=p.id
WHERE p.id IN (
  'dewaweb','jagoanhosting','domainesia','indonesian_cloud','bizfly_cloud',
  'ip_serverone','server_connect','sitedotnet','vhost_vietnam','vietnap',
  'vietvps','hostvn','1vps_vietnam','viettel_idc','telkomsigma_cloud'
)
GROUP BY p.id, p.name
ORDER BY p.name;
