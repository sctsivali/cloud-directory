#!/usr/bin/env python3
"""Load recovered Arena JSON into Postgres (print SQL to stdout)."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ASEAN = {"Indonesia", "Vietnam", "Malaysia", "Thailand", "Singapore", "Philippines"}


def esc(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    s = str(v).replace("\\", "\\\\").replace("'", "''")
    return "'" + s + "'"


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s[:80] or "unknown"


def parse_args(argv=None):
    p = argparse.ArgumentParser(prog="seed.py", description="Load recovered Arena JSON into Postgres SQL on stdout.")
    p.add_argument("input", type=Path, help="Path to database JSON containing a rows array")
    return p.parse_args(argv)


def stable_tier_id(provider_id: str, row: dict) -> str:
    existing = row.get("id")
    if existing not in (None, ""):
        return str(existing)
    payload = {
        "provider_id": provider_id,
        "tier_name": row.get("tier_name") or "",
        "vcpu": row.get("vCPU"),
        "ram_gb": row.get("ram_gb"),
        "storage_gb": row.get("storage_gb"),
        "price": row.get("price"),
        "currency": row.get("currency"),
        "dc_location": row.get("dc_location") or row.get("region") or "",
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    name_slug = slug(str(row.get("tier_name") or "tier"))
    return f"{provider_id}_{name_slug}_{digest}"


def generate_sql(data: dict) -> str:
    rows = data.get("rows", [])
    providers = {}
    locations = {}  # (city, country) -> None
    stacks = {}
    sov = {}
    loc_links = set()
    out = [
        "BEGIN;",
        "TRUNCATE tiers, sources, sovereignty, stacks, provider_locations, locations, providers CASCADE;",
    ]

    for r in rows:
        name = r.get("provider") or "Unknown"
        pid = slug(name)
        hq = r.get("provider_country") or r.get("country")
        origin = (r.get("provider_origin") or "unknown").lower()
        if origin not in ("local", "regional", "global"):
            origin = "local" if hq in ASEAN else "global"
        if pid not in providers:
            providers[pid] = {
                "id": pid,
                "name": name,
                "hq_country": hq,
                "hq_city": r.get("region") if hq else None,
                "origin": origin,
                "provider_type": r.get("provider_type"),
                "is_local_asean": hq in ASEAN and origin != "global",
            }
        if hq in ASEAN and origin != "global":
            providers[pid]["is_local_asean"] = True

        city = r.get("dc_location") or r.get("region") or "Unknown"
        country = r.get("country") or hq or "Unknown"
        locations[(city, country)] = None
        loc_links.add((pid, city, country))

        ts = r.get("tech_stack")
        if isinstance(ts, dict) and pid not in stacks:
            stacks[pid] = {
                "hypervisor": ts.get("hypervisor"),
                "container_runtime": ts.get("container_runtime"),
                "orchestration": ts.get("orchestration"),
                "storage": ts.get("storage"),
                "network": ts.get("network"),
                "control_plane": ts.get("control_plane"),
                "virtualization": r.get("virtualization"),
                "open_source": ts.get("open_source"),
                "open_source_score": r.get("open_source_score"),
                "open_source_grade": r.get("open_source_grade"),
                "source_url": ts.get("source"),
            }
            extra = ts.get("dc_locations")
            if extra:
                for part in re.split(r"[,;/]+", str(extra)):
                    part = part.strip()
                    if part:
                        locations[(part, hq or country)] = None
                        loc_links.add((pid, part, hq or country))
        elif pid not in stacks:
            stacks[pid] = {
                "hypervisor": None,
                "container_runtime": None,
                "orchestration": None,
                "storage": None,
                "network": None,
                "control_plane": None,
                "virtualization": r.get("virtualization"),
                "open_source": r.get("tech_open_source"),
                "open_source_score": r.get("open_source_score"),
                "open_source_grade": r.get("open_source_grade"),
                "source_url": None,
            }

        if pid not in sov:
            sov[pid] = {
                "score": None,
                "data_residency": r.get("data_residency"),
                "local_support": origin == "local",
                "sea_strength": r.get("sea_strength"),
            }

    loc_ids = {}
    i = 0
    for city, country in sorted(locations):
        i += 1
        loc_ids[(city, country)] = i
        out.append(
            "INSERT INTO locations (id, city, country) VALUES ("
            f"{i}, {esc(city)}, {esc(country)});"
        )
    if loc_ids:
        out.append(f"SELECT setval('locations_id_seq', {max(loc_ids.values())});")

    for p in providers.values():
        out.append(
            "INSERT INTO providers (id, name, hq_country, hq_city, origin, provider_type, is_local_asean) VALUES ("
            f"{esc(p['id'])}, {esc(p['name'])}, {esc(p['hq_country'])}, {esc(p['hq_city'])}, "
            f"{esc(p['origin'])}, {esc(p['provider_type'])}, {esc(p['is_local_asean'])});"
        )

    for pid, city, country in sorted(loc_links):
        lid = loc_ids.get((city, country))
        if lid:
            out.append(
                f"INSERT INTO provider_locations (provider_id, location_id) VALUES ({esc(pid)}, {lid}) ON CONFLICT DO NOTHING;"
            )

    for pid, s in stacks.items():
        out.append(
            "INSERT INTO stacks (provider_id, hypervisor, container_runtime, orchestration, storage, network, control_plane, virtualization, open_source, open_source_score, open_source_grade, source_url) VALUES ("
            f"{esc(pid)}, {esc(s['hypervisor'])}, {esc(s['container_runtime'])}, {esc(s['orchestration'])}, "
            f"{esc(s['storage'])}, {esc(s['network'])}, {esc(s['control_plane'])}, {esc(s['virtualization'])}, "
            f"{esc(s['open_source'])}, {esc(s['open_source_score'])}, {esc(s['open_source_grade'])}, {esc(s['source_url'])});"
        )

    for pid, s in sov.items():
        out.append(
            "INSERT INTO sovereignty (provider_id, score, data_residency, local_support, sea_strength) VALUES ("
            f"{esc(pid)}, {esc(s['score'])}, {esc(s['data_residency'])}, {esc(s['local_support'])}, {esc(s['sea_strength'])});"
        )

    for r in rows:
        pid = slug(r.get("provider") or "Unknown")
        tid = stable_tier_id(pid, r)
        raw = json.dumps(r, ensure_ascii=False).replace("\\", "\\\\").replace("'", "''")
        ipv4 = r.get("ipv4")
        if isinstance(ipv4, bool):
            ipv4 = 1 if ipv4 else 0
        ipv6 = r.get("ipv6")
        if ipv6 is None:
            ipv6 = False
        out.append(
            "INSERT INTO tiers (id, provider_id, tier_name, vcpu, cpu_type, cpu_family, ram_gb, storage_gb, storage_type, gpu, gpu_count, gpu_memory_gb, bandwidth, ipv4, ipv6, price_native, currency, price_usd_month, billing_period, status, raw) VALUES ("
            f"{esc(tid)}, {esc(pid)}, {esc(r.get('tier_name'))}, {esc(r.get('vCPU'))}, {esc(r.get('cpu_type'))}, "
            f"{esc(r.get('cpu_family'))}, {esc(r.get('ram_gb'))}, {esc(r.get('storage_gb'))}, {esc(r.get('storage_type'))}, "
            f"{esc(r.get('gpu'))}, {esc(r.get('gpu_count'))}, {esc(r.get('gpu_memory_gb'))}, {esc(r.get('bandwidth'))}, "
            f"{esc(ipv4)}, {esc(bool(ipv6))}, {esc(r.get('price'))}, {esc(r.get('currency'))}, "
            f"{esc(r.get('price_usd_per_month'))}, {esc(r.get('billing_period') or 'monthly')}, 'OK', '{raw}'::jsonb);"
        )

    out.append("COMMIT;")
    return "\n".join(out) + "\n"


def main(argv=None) -> int:
    args = parse_args(argv)
    path = args.input
    if not path.is_file():
        print(f"error: input not found: {path}", file=sys.stderr)
        return 2
    data = json.loads(path.read_text())
    sql = generate_sql(data)
    sys.stdout.write(sql)
    rows = data.get("rows", [])
    providers = {slug(r.get("provider") or "Unknown") for r in rows}
    loc_count = sql.count("INSERT INTO locations ")
    print(f"-- providers={len(providers)} locations={loc_count} tiers={len(rows)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
