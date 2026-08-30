#!/usr/bin/env python3
"""30-minute hunt: one uncovered official URL → provider_pipeline discovered.

Name+URL only. No SKU, hall, or hypervisor. Silent stdout if nothing new.
Notifies @ciaworker_bot home group when a row is inserted.
"""
from __future__ import annotations

import csv, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path("/home/hermes-prime/arena-next")
CSV = ROOT / "data" / "uncovered-candidates.csv"
BOT = ROOT / "scripts" / "ciaworker_bot.py"


def sh(sql: str) -> str:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=20,
    )
    if r.returncode != 0:
        print(r.stderr[-300:], file=sys.stderr)
        raise SystemExit(1)
    return r.stdout.strip()


def esc(s: str) -> str:
    return (s or "").replace("'", "''")


def known() -> tuple[set[str], set[str], set[str]]:
    ids, names, sites = set(), set(), set()
    out = sh("SELECT lower(id)||'|'||lower(name)||'|'||lower(coalesce(website,'')) FROM providers;")
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        ids.add(parts[0].strip())
        names.add(parts[1].strip())
        site = parts[2].strip().rstrip("/")
        if site:
            sites.add(site)
    out = sh("SELECT lower(coalesce(website,'')) FROM provider_pipeline;")
    for line in out.splitlines():
        if line.strip():
            sites.add(line.strip().rstrip("/"))
    return ids, names, sites


def alive(url: str) -> bool:
    try:
        from curl_cffi import requests as r
        resp = r.get(url, impersonate="chrome124", timeout=8, allow_redirects=True)
        code = int(resp.status_code)
        if code:
            return code != 404
    except Exception:
        pass
    try:
        import ssl, urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 CIA-Guide-hunt"})
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
            return int(resp.status) != 404
    except Exception as e:
        # 403 still means the host exists
        return "Error 403" in str(e) or "403" in str(e)


def host(url: str) -> str:
    return (urlparse(url).netloc or "").lower().removeprefix("www.")


def main() -> None:
    ids, names, sites = known()
    if not CSV.exists():
        return
    with CSV.open() as f:
        rows = list(csv.DictReader(f))
    picked = None
    for row in reversed(rows):
        pid = (row.get("id") or "").strip().lower()
        name = (row.get("name") or "").strip()
        url = (row.get("official_url") or "").strip()
        country = (row.get("country") or "").strip()
        if not url or not name:
            continue
        key = url.lower().rstrip("/")
        if pid in ids or name.lower() in names:
            continue
        if key in sites or host(url) in {urlparse(s).netloc.removeprefix("www.") for s in sites}:
            continue
        if not alive(url):
            continue
        picked = (name, url, country)
        break
    if not picked:
        return
    name, url, country = picked
    out = sh(
        "INSERT INTO provider_pipeline (name, website, country, status, reason) "
        f"SELECT '{esc(name)}', '{esc(url)}', '{esc(country)}', 'queued', "
        f"'auto crawl' "
        f"WHERE NOT EXISTS (SELECT 1 FROM provider_pipeline WHERE lower(website)=lower('{esc(url)}')) "
        "RETURNING id;"
    )
    if not out.isdigit():
        return
    r = subprocess.run(
        [sys.executable, str(BOT), "notify", out],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        print(f"notify fail {out}: {(r.stderr or r.stdout)[-200:]}", file=sys.stderr)


if __name__ == "__main__":
    main()
