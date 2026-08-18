BEGIN;

CREATE TEMP TABLE city_country (city text PRIMARY KEY, country text);
INSERT INTO city_country (city, country) VALUES
 ('Jakarta','Indonesia'),('Jakarta (Cibitung)','Indonesia'),('Cibitung','Indonesia'),
 ('Cikarang','Indonesia'),('Bekasi','Indonesia'),('BSD','Indonesia'),('Sentul','Indonesia'),
 ('Cimanggis','Indonesia'),('Yogyakarta','Indonesia'),('Surabaya','Indonesia'),
 ('Denpasar','Indonesia'),('Bandung','Indonesia'),('Medan','Indonesia'),
 ('Makassar','Indonesia'),('Manado','Indonesia'),('Balikpapan','Indonesia'),
 ('Singapore','Singapore'),('Singapore (SG)','Singapore'),('Singapore (SGP1)','Singapore'),
 ('Kuala Lumpur','Malaysia'),('Penang','Malaysia'),('Cyberjaya','Malaysia'),
 ('Petaling Jaya','Malaysia'),
 ('Hanoi','Vietnam'),('Ho Chi Minh','Vietnam'),('Ho Chi Minh City','Vietnam'),('Da Nang','Vietnam'),
 ('Bangkok','Thailand'),('Manila','Philippines'),
 ('Hong Kong','Hong Kong'),('Hong Kong (HK)','Hong Kong'),('Taipei','Taiwan'),
 ('Tokyo','Japan'),('Tokyo (JP)','Japan'),('Osaka','Japan'),
 ('Seoul','South Korea'),('Seoul (Gangnam)','South Korea'),('Seoul (Gasan)','South Korea'),('Seoul (KR)','South Korea'),
 ('Helsinki','Finland'),('Helsinki (FI)','Finland'),
 ('Frankfurt','Germany'),('Frankfurt (DE)','Germany'),('Frankfurt (FRA1)','Germany'),('Nuremberg','Germany'),
 ('Roubaix','France'),('Roubaix (FR)','France'),
 ('New York','United States'),('New York (NYC1-3)','United States'),('New York (US)','United States'),
 ('New York (NJ)','United States'),('Newark','United States'),('Newark (NJ)','United States'),
 ('Bangalore','India'),('Bangalore (BLR1)','India'),('Mumbai','India'),('Mumbai (IN)','India'),('Noida','India'),
 ('Sydney','Australia'),('Sydney (AU)','Australia'),('Sydney (SYD1)','Australia'),
 ('Canberra','Australia'),('Canberra (AU)','Australia'),
 ('São Paulo','Brazil'),('Sao Paulo','Brazil'),
 ('Cape Town','South Africa'),('Cape Town (ZA)','South Africa'),('Cape Town (af-south-1)','South Africa'),
 ('Johannesburg','South Africa'),('Centurion','South Africa'),
 ('Dubai','United Arab Emirates'),('Dubai (UAE)','United Arab Emirates'),
 ('Doha','Qatar'),('Doha (Qatar)','Qatar'),('Riyadh','Saudi Arabia'),
 ('Nairobi','Kenya'),('Nairobi (KE)','Kenya'),
 ('Wellington','New Zealand'),('Wellington (NZ)','New Zealand'),
 ('Beijing','China'),('Bahrain','Bahrain'),('Belo Horizonte','Brazil'),('Curitiba','Brazil'),
 ('Southeast Asia','Singapore'),('East Asia','Hong Kong');

-- Buildings: skip bulk country rewrite (same-statement unique collisions).
-- Listed halls already have correct countries. Unknown leftovers stay unnamed.

-- Tiers: pairing + known DC city corrections
UPDATE tiers SET dc_country='Finland', dc_city='Helsinki', dc_location='Helsinki'
WHERE provider_id='upcloud' AND dc_city ILIKE '%helsinki%';

UPDATE tiers SET dc_country='France', dc_city='Roubaix', dc_location='Roubaix'
WHERE provider_id='ovh' AND (dc_city ILIKE '%roubaix%' OR dc_location ILIKE '%roubaix%');

UPDATE tiers SET dc_country='United States', dc_city='New York', dc_location='New York'
WHERE provider_id='kamatera' AND dc_city ILIKE '%new york%';

UPDATE tiers SET dc_country='India', dc_city='Bangalore', dc_location='Bangalore'
WHERE provider_id='digitalocean' AND dc_city ILIKE '%bangalore%';

UPDATE tiers SET dc_country='Finland', dc_city='Helsinki', dc_location='Helsinki'
WHERE provider_id='hetzner_cloud' AND dc_city ILIKE '%helsinki%';

UPDATE tiers SET dc_country='Hong Kong', dc_city='Hong Kong', dc_location='Hong Kong'
WHERE provider_id IN ('jd_cloud','ucloud') AND dc_city ILIKE '%hong kong%';

UPDATE tiers SET dc_country='Taiwan', dc_city='Taipei', dc_location='Taipei'
WHERE provider_id='hicloud';

UPDATE tiers SET dc_city='Jakarta', dc_location='Jakarta', dc_country='Indonesia'
WHERE provider_id IN ('domainesia','rumahweb') AND dc_city ILIKE '%yogyakarta%';

UPDATE tiers SET dc_city='Cibitung', dc_location='Cibitung', dc_country='Indonesia'
WHERE provider_id='idcloudhost' AND (dc_location ILIKE '%cibitung%' OR dc_city ILIKE '%cibitung%');

UPDATE tiers SET dc_city='Singapore', dc_location='Singapore'
WHERE provider_id='oracle_cloud' AND dc_city ILIKE '%oracle%';

-- Normalize locations
CREATE TEMP TABLE loc_map AS
SELECT l.id AS old_id, l.city AS old_city, l.country AS old_country,
       CASE
         WHEN l.city = 'Jakarta (Cibitung)' THEN 'Cibitung'
         WHEN l.city IN ('Singapore (SG)','Singapore (SGP1)') THEN 'Singapore'
         WHEN l.city = 'Jakarta (via Singapore)' THEN 'Jakarta'
         WHEN l.city = 'Southeast Asia' THEN 'Singapore'
         WHEN l.city = 'East Asia' THEN 'Hong Kong'
         ELSE l.city
       END AS new_city,
       COALESCE(cc.country, l.country) AS new_country
FROM locations l
LEFT JOIN city_country cc ON cc.city = CASE
         WHEN l.city = 'Jakarta (Cibitung)' THEN 'Cibitung'
         WHEN l.city IN ('Singapore (SG)','Singapore (SGP1)') THEN 'Singapore'
         WHEN l.city = 'Jakarta (via Singapore)' THEN 'Jakarta'
         WHEN l.city = 'Southeast Asia' THEN 'Singapore'
         WHEN l.city = 'East Asia' THEN 'Hong Kong'
         ELSE l.city
       END;

INSERT INTO locations (city, country)
SELECT DISTINCT new_city, new_country FROM loc_map
WHERE new_city IS NOT NULL AND new_country IS NOT NULL
ON CONFLICT (city, country) DO NOTHING;

INSERT INTO provider_locations (provider_id, location_id)
SELECT DISTINCT pl.provider_id, tgt.id
FROM provider_locations pl
JOIN loc_map m ON m.old_id = pl.location_id
JOIN locations tgt ON tgt.city = m.new_city AND tgt.country = m.new_country
ON CONFLICT DO NOTHING;

DELETE FROM provider_locations pl
USING loc_map m
WHERE pl.location_id = m.old_id
  AND (m.old_city, m.old_country) IS DISTINCT FROM (m.new_city, m.new_country);

DELETE FROM locations l
WHERE NOT EXISTS (SELECT 1 FROM provider_locations pl WHERE pl.location_id = l.id)
  AND EXISTS (
    SELECT 1 FROM loc_map m
    WHERE m.old_id = l.id
      AND (m.old_city, m.old_country) IS DISTINCT FROM (m.new_city, m.new_country)
  );

INSERT INTO locations (city, country) VALUES
 ('Singapore','Singapore'),('Jakarta','Indonesia'),('Cibitung','Indonesia'),
 ('Cikarang','Indonesia'),('Sentul','Indonesia'),('Kuala Lumpur','Malaysia'),
 ('Johor Bahru','Malaysia'),('Bangkok','Thailand'),('Manila','Philippines'),
 ('Taipei','Taiwan'),('Helsinki','Finland'),('Roubaix','France'),
 ('New York','United States'),('Bangalore','India'),('Hong Kong','Hong Kong'),
 ('Ho Chi Minh City','Vietnam'),('Hanoi','Vietnam')
ON CONFLICT (city, country) DO NOTHING;

INSERT INTO provider_locations (provider_id, location_id)
SELECT v.pid, l.id
FROM (VALUES
  ('alibaba_cloud','Singapore','Singapore'),
  ('alibaba_cloud','Jakarta','Indonesia'),
  ('alibaba_cloud','Kuala Lumpur','Malaysia'),
  ('alibaba_cloud','Johor Bahru','Malaysia'),
  ('alibaba_cloud','Bangkok','Thailand'),
  ('alibaba_cloud','Manila','Philippines'),
  ('microsoft_azure','Singapore','Singapore'),
  ('microsoft_azure','Jakarta','Indonesia'),
  ('microsoft_azure','Kuala Lumpur','Malaysia'),
  ('microsoft_azure','Hong Kong','Hong Kong'),
  ('huawei_cloud','Singapore','Singapore'),
  ('huawei_cloud','Jakarta','Indonesia'),
  ('huawei_cloud','Bangkok','Thailand'),
  ('tencent_cloud','Singapore','Singapore'),
  ('tencent_cloud','Jakarta','Indonesia'),
  ('tencent_cloud','Bangkok','Thailand'),
  ('vultr','Singapore','Singapore'),
  ('upcloud','Singapore','Singapore'),
  ('upcloud','Helsinki','Finland'),
  ('ovh','Singapore','Singapore'),
  ('ovh','Roubaix','France'),
  ('kamatera','Singapore','Singapore'),
  ('kamatera','Hong Kong','Hong Kong'),
  ('kamatera','New York','United States'),
  ('digitalocean','Singapore','Singapore'),
  ('digitalocean','Bangalore','India'),
  ('hostinger','Singapore','Singapore'),
  ('hostinger','Jakarta','Indonesia'),
  ('hostinger','Kuala Lumpur','Malaysia'),
  ('hicloud','Taipei','Taiwan'),
  ('domainesia','Jakarta','Indonesia'),
  ('rumahweb','Jakarta','Indonesia'),
  ('idcloudhost','Cibitung','Indonesia'),
  ('idcloudhost','Jakarta','Indonesia'),
  ('telkomsigma_cloud','Jakarta','Indonesia'),
  ('telkomsigma_cloud','Cikarang','Indonesia'),
  ('telkomsigma_cloud','Sentul','Indonesia'),
  ('biznetgio','Jakarta','Indonesia'),
  ('fpt_smart_cloud','Hanoi','Vietnam'),
  ('fpt_smart_cloud','Ho Chi Minh City','Vietnam'),
  ('viettel_idc','Hanoi','Vietnam'),
  ('viettel_idc','Ho Chi Minh City','Vietnam')
) AS v(pid, city, country)
JOIN locations l ON l.city = v.city AND l.country = v.country
ON CONFLICT DO NOTHING;

DELETE FROM provider_locations pl
USING locations l
WHERE pl.provider_id = 'hicloud'
  AND pl.location_id = l.id
  AND l.city IN ('Hanoi','Ho Chi Minh City');

DELETE FROM provider_locations pl
USING locations l
WHERE pl.provider_id = 'hostinger'
  AND pl.location_id = l.id
  AND l.city ILIKE '%via singapore%';

COMMIT;
