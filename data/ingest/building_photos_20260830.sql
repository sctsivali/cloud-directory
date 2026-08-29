-- Official / Commons hall photos added 2026-08-30.
-- NeutraDC jakarta-1 = Cikarang (id 23); jakarta-3 = Sentul (id 24).
-- Cyber 1 = Commons File:Wisma_Cyber_-_panoramio.jpg (signage CYBER).
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
