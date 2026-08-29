-- Hall photos 2026-08-30 + merge Cyber 1 = Gedung Cyber.
UPDATE buildings SET
  photo_path='/building-photos/23.jpg',
  photo_credit='NeutraDC, foto resmi situs',
  photo_source='https://neutradc.com/data-center/jakarta-hq'
WHERE id=23;
UPDATE buildings SET
  photo_path='/building-photos/24.jpg',
  photo_credit='NeutraDC, foto resmi situs',
  photo_source='https://neutradc.com/data-center/jakarta-hq'
WHERE id=24;
UPDATE buildings SET
  photo_path='/building-photos/9.jpg',
  photo_credit='Wikimedia Commons / Panoramio, CC BY-SA 3.0',
  photo_source='https://commons.wikimedia.org/wiki/File:Wisma_Cyber_-_panoramio.jpg'
WHERE id=9;

-- Same building: Kuningan Barat, identical lat/lng.
CREATE TABLE IF NOT EXISTS provider_buildings_backup_cyber_merge_20260830 AS
  SELECT * FROM provider_buildings WHERE building_id IN (9,16);

UPDATE provider_buildings SET building_id = 9 WHERE building_id = 16;

UPDATE buildings SET
  name = 'Gedung Cyber 1',
  source = 'qwords.com/id/data-center: Cyber 1 Lt.3; rumahweb.com/datacenter: Datacenter di Gedung Cyber. Satu bangunan (Kuningan Barat).'
WHERE id = 9;

UPDATE buildings SET
  listed = false,
  source = COALESCE(source,'') || ' | merged into building 9: Cyber 1 = Gedung Cyber (same lat/lng Kuningan Barat)'
WHERE id = 16;
