-- Building facility facts (2026-08-30). Null stays Not disclosed.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS operator_country text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS dc_tier text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS telcos text;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS dc_tech text;

UPDATE buildings SET operator='NeutraDC (PT Telkom Data Ekosistem)', operator_country='Indonesia', telcos='Carrier Neutral', dc_tech='2N power' WHERE id IN (23,24);
UPDATE buildings SET operator='NEX Data Center (PT CBN Nusantara)', operator_country='Indonesia', dc_tier='Tier III', telcos='Carrier Neutral' WHERE id IN (22,20);
UPDATE buildings SET operator='PT DCI Indonesia Tbk', operator_country='Indonesia', dc_tier=NULL WHERE id=10;
UPDATE buildings SET dc_tier='Tier 3', telcos='Carrier Neutral', dc_tech='N+1 cooling' WHERE id=348;
UPDATE buildings SET operator='FPT Telecom', operator_country='Vietnam', dc_tier='Uptime Tier III; ANSI/TIA-942 Rated-3' WHERE id IN (12,13,14,15);
UPDATE buildings SET operator='STT GDC Vietnam (JV VNG)', operator_country='Singapore' WHERE id=25;
UPDATE buildings SET operator='Viettel IDC', operator_country='Vietnam' WHERE id IN (321,322,324,325,326,327);
UPDATE buildings SET operator='VNPT', operator_country='Vietnam' WHERE id=320;
UPDATE buildings SET operator='PLDT', operator_country='Philippines', telcos='PLDT' WHERE id=1240;
UPDATE buildings SET operator='AIMS Data Centre', operator_country='Malaysia' WHERE id IN (8,19);
UPDATE buildings SET operator='BDx Indonesia (Lintasarta / IOH)', operator_country='Indonesia' WHERE id IN (6,7,18,28);
UPDATE buildings SET operator='PT Biznet Gio Nusantara', operator_country='Indonesia' WHERE id=21;
UPDATE buildings SET operator_country='Indonesia' WHERE id IN (1,9);
UPDATE buildings SET operator='NTT', operator_country='Japan' WHERE id=328;
UPDATE buildings SET operator='IDC Indonesia', operator_country='Indonesia' WHERE id=17;
