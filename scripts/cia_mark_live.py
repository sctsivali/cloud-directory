#!/usr/bin/env python3
"""Mark a pipeline row live only if the Guide page exists.

Usage: cia_mark_live.py PIPELINE_ID PROVIDER_ID
Silent if already live. Refuses (exit 2) if /provider/<id> is not 200.
"""
from __future__ import annotations

import json, subprocess, sys, urllib.request
from pathlib import Path

BOT = Path("/home/hermes-prime/arena-next/scripts/ciaworker_bot.py")


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


def page_ok(pid: str) -> bool:
    if not sh(f"SELECT 1 FROM providers WHERE id='{esc(pid)}' LIMIT 1;"):
        return False
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:3001/provider/{pid}",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            return int(resp.status) == 200
    except Exception:
        return False


def main() -> None:
    if len(sys.argv) < 3:
        return
    rid, pid = int(sys.argv[1]), sys.argv[2].strip()
    row = sh(
        "SELECT json_build_object('name',name,'website',website,'status',status) "
        f"FROM provider_pipeline WHERE id={rid};"
    )
    if not row:
        return
    d = json.loads(row)
    if (d.get("status") or "") == "live":
        if page_ok(pid):
            return
        sh(
            f"UPDATE provider_pipeline SET status='ingested', "
            f"reason='false live — no /provider/{esc(pid)}', updated_at=now() "
            f"WHERE id={rid};"
        )
        raise SystemExit(2)
    if not page_ok(pid):
        print(f"not live: missing providers/{pid} or HTTP != 200", file=sys.stderr)
        raise SystemExit(2)
    href = f"https://guide.cloudin.asia/provider/{pid}"
    sh(
        f"UPDATE provider_pipeline SET status='live', reason='live {esc(pid)}', "
        f"notified_at=now(), updated_at=now() WHERE id={rid} AND status <> 'live';"
    )
    text = f"Live Guide: {d.get('name')}\n{href}"
    subprocess.run([sys.executable, str(BOT), "announce", text], check=False, timeout=30)


if __name__ == "__main__":
    main()
