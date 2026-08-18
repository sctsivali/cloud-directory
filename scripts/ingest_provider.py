#!/usr/bin/env python3
"""Validate a provider ingest JSON then emit SQL. Never truncates."""
from __future__ import annotations

import json, sys, argparse
from pathlib import Path

ASEAN = {
    "Indonesia", "Malaysia", "Singapore", "Thailand", "Vietnam",
    "Philippines", "Cambodia", "Laos", "Myanmar", "Brunei",
}
NEEDED_P = ("id", "name", "hq_country", "legal_country", "website", "origin")


def die(msg: str) -> None:
    print("REJECT:", msg, file=sys.stderr)
    sys.exit(2)


def sql_str(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def validate(doc: dict) -> None:
    p = doc.get("provider") or {}
    for k in NEEDED_P:
        if not p.get(k):
            die(f"provider.{k} required")
    if not (doc.get("sources") or []):
        die("at least one official source URL")
    if not str(doc["sources"][0]).startswith("http"):
        die("source must be http(s)")
    if p["hq_country"] in {"Germany", "France", "Finland"} and p.get("origin") != "global":
        die("Europe-only must be marked global; skip unless ASEAN DC")
    loc = doc.get("locations") or []
    city = doc.get("dc_city") or ""
    if city and city != "Undisclosed":
        if not any(l.get("city") == city for l in loc):
            die("dc_city must appear in official locations")
    fx = float(doc.get("fx_idr_per_usd") or 16000)
    for t in doc.get("tiers") or []:
        for k in ("id", "tier_name", "vcpu", "ram_gb", "price_idr"):
            if t.get(k) in (None, ""):
                die(f"tier {t.get('id')} missing {k}")
        if int(t["vcpu"]) < 1 or float(t["ram_gb"]) < 1:
            die(f"tier {t['id']} bad specs")
        if t.get("storage_gb") not in (None, ""):
            if float(t["storage_gb"]) <= 0:
                die(f"tier {t['id']} bad storage")
        else:
            t["storage_gb"] = None
        usd = float(t["price_idr"]) / fx
        if usd <= 0:
            die(f"tier {t['id']} non-positive price")
        if int(t["vcpu"]) >= 8 and usd < int(t["vcpu"]) * 0.2:
            die(f"tier {t['id']} price looks invalid (${usd:.2f} for {t['vcpu']} vCPU)")
        t["_usd"] = round(usd, 2)
        t["_status"] = "OK"
    if not doc.get("tiers"):
        if not doc.get("allow_no_tiers"):
            die("no VPS tiers — refuse empty provider")
        if not (doc.get("locations") or []):
            die("no-tier provider still needs official locations")


def emit_sql(doc: dict) -> str:
    p = doc["provider"]
    fx = float(doc.get("fx_idr_per_usd") or 16000)
    lines = ["BEGIN;"]
    lines.append(
        f"INSERT INTO providers (id,name,hq_country,hq_city,origin,provider_type,is_local_asean,website,legal_country,legal_note) "
        f"VALUES ({sql_str(p['id'])},{sql_str(p['name'])},{sql_str(p.get('hq_country'))},{sql_str(p.get('hq_city'))},"
        f"{sql_str(p.get('origin'))},{sql_str(p.get('provider_type'))},{'TRUE' if p.get('is_local_asean') else 'FALSE'},"
        f"{sql_str(p.get('website'))},{sql_str(p.get('legal_country'))},{sql_str(p.get('legal_note'))}) "
        f"ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, hq_country=EXCLUDED.hq_country, hq_city=EXCLUDED.hq_city, "
        f"origin=EXCLUDED.origin, provider_type=EXCLUDED.provider_type, is_local_asean=EXCLUDED.is_local_asean, "
        f"website=EXCLUDED.website, legal_country=EXCLUDED.legal_country, legal_note=EXCLUDED.legal_note;"
    )
    st = doc.get("stack") or {}
    src = ", ".join(doc["sources"])
    lines.append(
        f"INSERT INTO stacks (provider_id, hypervisor, source_url) VALUES "
        f"({sql_str(p['id'])},{sql_str(st.get('hypervisor'))},{sql_str(src)}) "
        f"ON CONFLICT (provider_id) DO UPDATE SET hypervisor=EXCLUDED.hypervisor, source_url=EXCLUDED.source_url;"
    )
    lines.append(
        f"INSERT INTO sovereignty (provider_id, data_residency) VALUES "
        f"({sql_str(p['id'])},{sql_str((doc.get('sovereignty') or {}).get('data_residency','local'))}) "
        f"ON CONFLICT (provider_id) DO UPDATE SET data_residency=EXCLUDED.data_residency;"
    )
    lines.append(f"DELETE FROM sources WHERE provider_id = {sql_str(p['id'])};")
    for u in doc["sources"]:
        lines.append(
            f"INSERT INTO sources (provider_id, url, scraped_at, status) VALUES "
            f"({sql_str(p['id'])},{sql_str(u)}, now(), 'OK');"
        )
    for loc in doc.get("locations") or []:
        lines.append(
            f"INSERT INTO locations (city, country) VALUES ({sql_str(loc['city'])},{sql_str(loc['country'])}) "
            f"ON CONFLICT (city, country) DO NOTHING;"
        )
        lines.append(
            f"INSERT INTO provider_locations (provider_id, location_id) "
            f"SELECT {sql_str(p['id'])}, id FROM locations WHERE city={sql_str(loc['city'])} AND country={sql_str(loc['country'])} "
            f"ON CONFLICT DO NOTHING;"
        )
    for bid in doc.get("buildings") or []:
        lines.append(
            f"INSERT INTO provider_buildings (provider_id, building_id) VALUES ({sql_str(p['id'])},{int(bid)}) "
            f"ON CONFLICT DO NOTHING;"
        )
    for b in doc.get("buildings_named") or []:
        if not b.get("name") or not b.get("city") or not b.get("country"):
            continue
        lines.append(
            f"INSERT INTO buildings (name, city, country, source, listed, operator) VALUES ("
            f"{sql_str(b['name'])},{sql_str(b['city'])},{sql_str(b['country'])},"
            f"{sql_str(b.get('source'))}, TRUE, {sql_str(b.get('operator'))}) "
            f"ON CONFLICT (name, city, country) DO UPDATE SET listed=TRUE, source=COALESCE(buildings.source, EXCLUDED.source);"
        )
        lines.append(
            f"INSERT INTO provider_buildings (provider_id, building_id) "
            f"SELECT {sql_str(p['id'])}, id FROM buildings WHERE name={sql_str(b['name'])} AND city={sql_str(b['city'])} AND country={sql_str(b['country'])} "
            f"ON CONFLICT DO NOTHING;"
        )
    dc_city = doc.get("dc_city") or "Undisclosed"
    dc_country = doc.get("dc_country") or ""
    dc_loc = doc.get("dc_location") or ("Undisclosed building" if dc_city == "Undisclosed" else dc_city)
    hv = (doc.get("stack") or {}).get("hypervisor")
    for t in doc["tiers"]:
        raw = json.dumps({"source": doc.get("scraped_from"), "price_idr": t["price_idr"], "fx": fx}, ensure_ascii=False)
        stor = "NULL" if t.get("storage_gb") is None else str(float(t["storage_gb"]))
        dc_c = t.get("dc_city") or dc_city
        dc_co = t.get("dc_country") or dc_country
        dc_l = t.get("dc_location") or ("Undisclosed building" if dc_c == "Undisclosed" else dc_c)
        lines.append(
            f"INSERT INTO tiers (id, provider_id, tier_name, vcpu, ram_gb, storage_gb, storage_type, "
            f"price_native, currency, price_usd_month, billing_period, dc_location, dc_city, dc_country, "
            f"hypervisor, status, raw) VALUES ("
            f"{sql_str(t['id'])},{sql_str(p['id'])},{sql_str(t['tier_name'])},{int(t['vcpu'])},"
            f"{float(t['ram_gb'])},{stor},{sql_str(t.get('storage_type'))},"
            f"{sql_str(t['price_native'])},'IDR',{t['_usd']},'monthly',"
            f"{sql_str(dc_l)},{sql_str(dc_c)},{sql_str(dc_co)},"
            f"{sql_str(hv)},{sql_str(t['_status'])},{sql_str(raw)}) "
            f"ON CONFLICT (id) DO UPDATE SET tier_name=EXCLUDED.tier_name, vcpu=EXCLUDED.vcpu, ram_gb=EXCLUDED.ram_gb, "
            f"storage_gb=EXCLUDED.storage_gb, storage_type=EXCLUDED.storage_type, price_native=EXCLUDED.price_native, "
            f"price_usd_month=EXCLUDED.price_usd_month, dc_location=EXCLUDED.dc_location, dc_city=EXCLUDED.dc_city, "
            f"dc_country=EXCLUDED.dc_country, hypervisor=EXCLUDED.hypervisor, status=EXCLUDED.status, "
            f"raw=EXCLUDED.raw, updated_at=now();"
        )
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("json_path")
    ap.add_argument("-o", "--out", default="-")
    args = ap.parse_args()
    doc = json.loads(Path(args.json_path).read_text())
    validate(doc)
    sql = emit_sql(doc)
    if args.out == "-":
        sys.stdout.write(sql)
    else:
        Path(args.out).write_text(sql)
        print("OK", doc["provider"]["id"], "tiers", len(doc["tiers"]), "->", args.out)


if __name__ == "__main__":
    main()
