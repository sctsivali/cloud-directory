#!/usr/bin/env python3
"""Hunt unmarked CSV rows once.

skip_if:
  hunted   — queued for Deep Intelligence Check (do not re-probe)
  in_guide — already a provider
  dead     — URL not alive (do not retry every tick)
  reject   — directory/global host
"""
from __future__ import annotations

import csv, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path("/home/hermes-prime/arena-next")
CSV = ROOT / "data" / "uncovered-candidates.csv"
BOT = ROOT / "scripts" / "ciaworker_bot.py"
FIELDS = ["priority", "id", "name", "country", "official_url", "skip_if"]
DONE = {"hunted", "dead", "reject", "in_guide"}
MAX_QUEUE = 5
REJECT_HOSTS = {
    "datacentermap.com", "datacenterhawk.com", "vpssos.com",
    "howtohosting.guide", "indexbox.io", "vpsknow.com",
    "amazonaws.com", "azure.com", "digitalocean.com", "vultr.com",
    "hostinger.com", "hostinger.co.id", "cloudzy.com", "lightnode.com",
}


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
        return "Error 403" in str(e) or "403" in str(e)


def host(url: str) -> str:
    return (urlparse(url).netloc or "").lower().removeprefix("www.")


def flush_notify() -> None:
    r = subprocess.run(
        [sys.executable, str(BOT), "notify-pending"],
        capture_output=True, text=True, timeout=90,
    )
    if r.returncode != 0:
        print(f"notify-pending fail: {(r.stderr or r.stdout)[-200:]}", file=sys.stderr)


def save(rows: list[dict]) -> None:
    with CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def enqueue(name: str, url: str, country: str) -> bool:
    out = sh(
        "INSERT INTO provider_pipeline (name, website, country, status, reason) "
        f"SELECT '{esc(name)}', '{esc(url)}', '{esc(country)}', 'queued', "
        f"'hunted' "
        f"WHERE NOT EXISTS (SELECT 1 FROM provider_pipeline WHERE lower(website)=lower('{esc(url)}')) "
        "RETURNING id;"
    )
    return out.isdigit()


def main() -> None:
    flush_notify()
    ids, names, sites = known()
    if not CSV.exists():
        return
    with CSV.open() as f:
        rows = list(csv.DictReader(f))
    site_hosts = {urlparse(s).netloc.removeprefix("www.") for s in sites}
    changed = False
    queued = 0
    for row in rows:
        flag = (row.get("skip_if") or "").strip().lower()
        if flag in DONE:
            continue
        url = (row.get("official_url") or "").strip()
        name = (row.get("name") or "").strip()
        pid = (row.get("id") or "").strip().lower()
        country = (row.get("country") or "").strip()
        if not url or not name:
            row["skip_if"] = "dead"
            changed = True
            continue
        key = url.lower().rstrip("/")
        h = host(url)
        if pid in ids or name.lower() in names:
            row["skip_if"] = "in_guide"
            changed = True
            continue
        if key in sites or h in site_hosts:
            row["skip_if"] = "hunted"
            changed = True
            continue
        if h in REJECT_HOSTS or any(h.endswith("." + x) for x in REJECT_HOSTS):
            row["skip_if"] = "reject"
            changed = True
            continue
        if not alive(url):
            row["skip_if"] = "dead"
            changed = True
            continue
        if enqueue(name, url, country):
            sites.add(key)
            site_hosts.add(h)
            queued += 1
        row["skip_if"] = "hunted"
        changed = True
        if queued >= MAX_QUEUE:
            break
    if changed:
        save(rows)


if __name__ == "__main__":
    main()
