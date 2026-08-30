#!/usr/bin/env python3
"""Mark a pipeline row live after ingest, announce Redaksi. Silent if bad args.

Usage: cia_mark_live.py PIPELINE_ID PROVIDER_ID
"""
from __future__ import annotations

import subprocess, sys
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


def main() -> None:
    if len(sys.argv) < 3:
        return
    rid, pid = int(sys.argv[1]), sys.argv[2].strip()
    row = sh(
        "SELECT json_build_object('name',name,'website',website,'reason',reason) "
        f"FROM provider_pipeline WHERE id={rid};"
    )
    if not row:
        return
    import json
    d = json.loads(row)
    href = f"https://guide.cloudin.asia/provider/{pid}"
    reason = (d.get("reason") or "") + f" | live {pid}"
    sh(
        f"UPDATE provider_pipeline SET status='ingested', reason='{esc(reason)}', "
        f"updated_at=now() WHERE id={rid};"
    )
    who = d.get("reason") or ""
    text = (
        f"Live Guide: {d.get('name')}\n"
        f"{href}\n"
        f"{who}"
    )
    subprocess.run([sys.executable, str(BOT), "announce", text], check=False, timeout=30)


if __name__ == "__main__":
    main()
