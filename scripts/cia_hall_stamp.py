#!/usr/bin/env python3
"""Stamp last_checked_at so the hall is skipped for 30 days.

Usage: cia_hall_stamp.py BUILDING_ID [source_url]
"""
from __future__ import annotations

import subprocess, sys

def sh(sql: str) -> None:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=20,
    )
    if r.returncode != 0:
        print(r.stderr[-300:], file=sys.stderr)
        raise SystemExit(1)

def esc(s: str) -> str:
    return (s or "").replace("'", "''")

def main() -> None:
    if len(sys.argv) < 2:
        return
    bid = int(sys.argv[1])
    src = esc(sys.argv[2]) if len(sys.argv) > 2 else ""
    extra = f", check_source='{src}'" if src else ""
    sh(
        f"UPDATE buildings SET last_checked_at=now(){extra} "
        f"WHERE id={bid} AND listed;"
    )

if __name__ == "__main__":
    main()
