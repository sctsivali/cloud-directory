#!/usr/bin/env python3
"""Discover helper.

  cia_discover_append.py next              → prints COUNTRY<TAB>query, advances cursor
  cia_discover_append.py NAME URL COUNTRY  → append CSV if new (print 'added …' or silent)
"""
from __future__ import annotations

import csv, json, re, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path("/home/hermes-prime/arena-next")
CSV = ROOT / "data" / "uncovered-candidates.csv"
STATE = ROOT / "data" / ".discover-search-state.json"
QUERIES = [
    ("Indonesia", "VPS Indonesia cloud server official site"),
    ("Indonesia", "IaaS Indonesia KVM OpenStack"),
    ("Malaysia", "VPS Malaysia cloud server official"),
    ("Thailand", "VPS Thailand cloud server official"),
    ("Vietnam", "VPS Vietnam cloud server official"),
    ("Philippines", "VPS Philippines cloud server official"),
    ("Singapore", "VPS Singapore local cloud provider"),
    ("Cambodia", "VPS Cambodia cloud server"),
    ("Laos", "VPS Laos cloud server"),
    ("Myanmar", "VPS Myanmar cloud server"),
    ("Brunei", "VPS Brunei cloud server"),
]
GLOBAL = {
    "amazonaws.com", "aws.amazon.com", "azure.com", "microsoft.com",
    "cloud.google.com", "oracle.com", "alibabacloud.com", "aliyun.com",
    "tencentcloud.com", "huaweicloud.com", "digitalocean.com", "linode.com",
    "akamai.com", "vultr.com", "hetzner.com", "ovh.com", "ovhcloud.com",
    "contabo.com", "hostinger.com", "hostinger.co.id", "cloudzy.com",
    "lightnode.com", "go.lightnode.com", "kamatera.com", "aiccloud.in",
}
BLOG = {
    "vpssos.com", "howtohosting.guide", "indexbox.io", "vpsknow.com",
 "datacentermap.com", "datacenterhawk.com",
    "wikipedia.org", "reddit.com", "youtube.com", "facebook.com",
    "linkedin.com", "medium.com", "quora.com",
}


def sh(sql: str) -> str:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=20,
    )
    return r.stdout.strip() if r.returncode == 0 else ""


def host_of(url: str) -> str:
    h = (urlparse(url).netloc or "").lower()
    if h.startswith("www."):
        h = h[4:]
    return h


def slug(host: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "", host.replace(".", "_").lower())
    return s[:40] or "cand"


def origin(url: str) -> str:
    p = urlparse(url)
    if not p.scheme or not p.netloc:
        return url
    return f"{p.scheme}://{p.netloc}/"


def next_query() -> None:
    cur = 0
    if STATE.exists():
        try:
            cur = int(json.loads(STATE.read_text()).get("cursor") or 0)
        except Exception:
            cur = 0
    country, q = QUERIES[cur % len(QUERIES)]
    STATE.write_text(json.dumps({"cursor": (cur + 1) % len(QUERIES), "last": q}) + "\n")
    print(f"{country}\t{q}")


def append(name: str, url: str, country: str) -> None:
    if not name or not url.startswith("http"):
        return
    h = host_of(url)
    if not h or h in GLOBAL or h in BLOG:
        return
    if any(h == g or h.endswith("." + g) for g in GLOBAL | BLOG):
        return
    home = origin(url)
    pid = slug(h)
    ids, names, sites = set(), set(), set()
    for line in sh(
        "SELECT lower(id)||'|'||lower(name)||'|'||lower(coalesce(website,'')) FROM providers;"
    ).splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        ids.add(parts[0].strip())
        names.add(parts[1].strip())
        if parts[2].strip():
            sites.add(host_of(parts[2]))
    rows = []
    if CSV.exists():
        with CSV.open() as f:
            rows = list(csv.DictReader(f))
    for row in rows:
        ids.add((row.get("id") or "").strip().lower())
        names.add((row.get("name") or "").strip().lower())
        sites.add(host_of(row.get("official_url") or ""))
    for line in sh("SELECT lower(coalesce(website,'')) FROM provider_pipeline;").splitlines():
        if line.strip():
            sites.add(host_of(line))
    if pid in ids or name.lower() in names or h in sites:
        return
    fieldnames = ["priority", "id", "name", "country", "official_url", "skip_if"]
    rows.append({
        "priority": "P2",
        "id": pid,
        "name": name[:80],
        "country": country[:40],
        "official_url": home,
        "skip_if": "discover-30m",
    })
    with CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    print(f"added {pid} {home}")


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "next":
        next_query()
        return
    if len(sys.argv) < 4:
        return
    append(sys.argv[1].strip(), sys.argv[2].strip(), sys.argv[3].strip())


if __name__ == "__main__":
    main()
