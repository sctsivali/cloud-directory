#!/usr/bin/env python3
"""Build SQL seed for buildings + provider_buildings from the audit CSV."""
import csv
import re
from pathlib import Path

csv_path = Path("/home/hermes-prime/arena-next/data/dc-building-audit.csv")

def split_names(name: str) -> list[str]:
    name = (name or "").strip()
    if not name or name == "Unknown Building":
        return ["Unknown Building"]
    parts = [p.strip() for p in re.split(r"\s+/ \s*", name) if p.strip()]
    return parts or [name]

rows = list(csv.DictReader(csv_path.open()))
# unique buildings
buildings = {}  # (name, city, country) -> {source, listed}
links = set()  # (provider_id, name, city, country)

for r in rows:
    city = (r.get("city") or "").strip() or "Unknown"
    country = (r.get("country") or "").strip() or "Unknown"
    src = (r.get("source") or "").strip()
    listed_row = (r.get("confidence") or "") == "public-listed"
    for name in split_names(r.get("building") or "Unknown Building"):
        listed = listed_row and name != "Unknown Building"
        key = (name, city, country)
        prev = buildings.get(key)
        if not prev or (listed and not prev["listed"]):
            buildings[key] = {"source": src, "listed": listed}
        elif listed and src and not prev["source"]:
            prev["source"] = src
        links.add((r["provider_id"], name, city, country))

def esc(s: str) -> str:
    return s.replace("'", "''")

out = []
out.append("BEGIN;")
out.append("CREATE TABLE IF NOT EXISTS buildings (")
out.append("  id SERIAL PRIMARY KEY,")
out.append("  name TEXT NOT NULL,")
out.append("  city TEXT NOT NULL,")
out.append("  country TEXT NOT NULL,")
out.append("  source TEXT,")
out.append("  listed BOOLEAN NOT NULL DEFAULT FALSE,")
out.append("  UNIQUE (name, city, country)")
out.append(");")
out.append("CREATE TABLE IF NOT EXISTS provider_buildings (")
out.append("  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,")
out.append("  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,")
out.append("  PRIMARY KEY (provider_id, building_id)")
out.append(");")
out.append("CREATE INDEX IF NOT EXISTS idx_buildings_listed ON buildings(listed);")
out.append("CREATE INDEX IF NOT EXISTS idx_provider_buildings_building ON provider_buildings(building_id);")
out.append("TRUNCATE provider_buildings, buildings RESTART IDENTITY;")

for (name, city, country), meta in sorted(buildings.items()):
    out.append(
        "INSERT INTO buildings (name, city, country, source, listed) VALUES ("
        f"'{esc(name)}', '{esc(city)}', '{esc(country)}', "
        f"{('NULL' if not meta['source'] else chr(39)+esc(meta['source'])+chr(39))}, "
        f"{'TRUE' if meta['listed'] else 'FALSE'}"
        ") ON CONFLICT (name, city, country) DO UPDATE SET "
        "source = COALESCE(EXCLUDED.source, buildings.source), "
        "listed = buildings.listed OR EXCLUDED.listed;"
    )

for pid, name, city, country in sorted(links):
    out.append(
        "INSERT INTO provider_buildings (provider_id, building_id) "
        "SELECT p.id, b.id FROM providers p, buildings b "
        f"WHERE p.id = '{esc(pid)}' AND b.name = '{esc(name)}' "
        f"AND b.city = '{esc(city)}' AND b.country = '{esc(country)}' "
        "ON CONFLICT DO NOTHING;"
    )

out.append("COMMIT;")
sql_path = Path("/tmp/dc-audit/seed_buildings.sql")
sql_path.write_text("\n".join(out) + "\n")
print(f"buildings={len(buildings)} links={len(links)} sql={sql_path} bytes={sql_path.stat().st_size}")
print("listed", sum(1 for m in buildings.values() if m["listed"]))
