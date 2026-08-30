#!/usr/bin/env python3
"""Pick one listed building due for a 30-day hall check. Prints JSON or nothing."""
from __future__ import annotations

import json, subprocess, sys

sql = """
SELECT json_build_object(
  'id', id, 'name', name, 'city', city, 'country', country,
  'address', address, 'operator', operator, 'operator_country', operator_country,
  'dc_tier', dc_tier, 'telcos', telcos, 'dc_tech', dc_tech, 'facilities', facilities,
  'lat', lat, 'lng', lng, 'photo_path', photo_path, 'source', source,
  'last_checked_at', last_checked_at
)
FROM buildings
WHERE listed
  AND (last_checked_at IS NULL OR last_checked_at < now() - interval '30 days')
ORDER BY last_checked_at NULLS FIRST, id
LIMIT 1;
"""
r = subprocess.run(
    ["sg", "docker", "-c",
     "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
    input=sql, capture_output=True, text=True, timeout=20,
)
if r.returncode != 0:
    print(r.stderr[-300:], file=sys.stderr)
    raise SystemExit(1)
out = r.stdout.strip()
if out:
    print(out)
