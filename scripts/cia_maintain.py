#!/usr/bin/env python3
"""Daily source-health for providers already in Guide. Silent if unchanged."""
from __future__ import annotations

import json, subprocess, sys
from pathlib import Path

ROOT = Path("/home/hermes-prime/arena-next")
STATE = ROOT / "data" / ".source-health.json"
BOT = ROOT / "scripts" / "ciaworker_bot.py"


def sh(sql: str) -> str:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=30,
    )
    return r.stdout.strip() if r.returncode == 0 else ""


def probe(url: str) -> int:
    try:
        from curl_cffi import requests as r
        resp = r.get(url, impersonate="chrome124", timeout=15, allow_redirects=True)
        return int(resp.status_code)
    except Exception:
        return 0


def main() -> None:
    prev = {}
    if STATE.exists():
        try:
            prev = json.loads(STATE.read_text())
        except Exception:
            prev = {}
    out = sh("SELECT id||'\\t'||coalesce(website,'') FROM providers WHERE website <> '' ORDER BY id;")
    now = {}
    flips = []
    for line in out.splitlines():
        pid, url = (line.split("\t", 1) + [""])[:2]
        if not url.startswith("http"):
            continue
        code = probe(url)
        now[pid] = {"url": url, "status": code}
        old = (prev.get(pid) or {}).get("status")
        if old is not None and old != code:
            flips.append(f"{pid} {old}->{code}")
    STATE.write_text(json.dumps(now, indent=2) + "\n")
    if not flips:
        return
    # reuse pipeline notify by inserting a maintenance card
    reason = "source-health " + "; ".join(flips[:8])
    rid = sh(
        "INSERT INTO provider_pipeline (name, website, country, status, reason) "
        f"VALUES ('source-health', '', '', 'needs_review', '{reason.replace(chr(39), chr(39)+chr(39))}') "
        "RETURNING id;"
    )
    if rid.isdigit():
        subprocess.run([sys.executable, str(BOT), "notify", rid], check=False, timeout=30)


if __name__ == "__main__":
    main()
