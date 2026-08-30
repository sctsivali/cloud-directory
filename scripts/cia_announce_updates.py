#!/usr/bin/env python3
"""Post new directory_updates rows to Redaksi. Silent if none."""
from __future__ import annotations

import json, subprocess, sys
from pathlib import Path

ROOT = Path("/home/hermes-prime/arena-next")
STATE = ROOT / "data" / ".updates-announce-state.json"
BOT = ROOT / "scripts" / "ciaworker_bot.py"


def sh(sql: str) -> str:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=20,
    )
    return r.stdout.strip() if r.returncode == 0 else ""


def main() -> None:
    last = 0
    if STATE.exists():
        try:
            last = int(json.loads(STATE.read_text()).get("last_id") or 0)
        except Exception:
            last = 0
    if last == 0:
        raw = sh("SELECT coalesce(max(id),0) FROM directory_updates;")
        last = int(raw or 0)
        STATE.write_text(json.dumps({"last_id": last}) + "\n")
        return
    out = sh(
        "SELECT json_agg(json_build_object('id',id,'title',title_id,'href',href) ORDER BY id) "
        f"FROM directory_updates WHERE id > {int(last)};"
    )
    if not out:
        return
    rows = json.loads(out) or []
    max_id = last
    for row in rows[:15]:
        rid = int(row["id"])
        max_id = max(max_id, rid)
        title = row.get("title") or f"update #{rid}"
        href = row.get("href") or "/updates"
        if href.startswith("/"):
            href = "https://guide.cloudin.asia" + href
        text = f"Update Guide: {title}\n{href}"
        subprocess.run(
            [sys.executable, str(BOT), "announce", text],
            check=False, timeout=30,
        )
    STATE.write_text(json.dumps({"last_id": max_id}) + "\n")


if __name__ == "__main__":
    main()
