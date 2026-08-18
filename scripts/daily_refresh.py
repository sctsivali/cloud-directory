#!/usr/bin/env python3
"""Daily refresh: probe official URLs and re-upsert known ingest JSON.

Does not invent prices or halls. Does not truncate. Does not scrape new providers.
"""
from __future__ import annotations

import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/hermes-prime/arena-next")
INGEST = ROOT / "data" / "ingest"
GATE = ROOT / "scripts" / "ingest_provider.py"
TMP = Path("/tmp/cd-daily")


def probe(url: str) -> int:
    try:
        from curl_cffi import requests as r

        resp = r.get(url, impersonate="chrome124", timeout=18, allow_redirects=True)
        return int(resp.status_code)
    except Exception:
        try:
            p = subprocess.run(
                ["curl", "-sI", "-L", "--max-time", "15", "-o", "/dev/null", "-w", "%{http_code}",
                 "-A", "Mozilla/5.0 CloudDirectoryDaily/1.0", url],
                capture_output=True, text=True, timeout=20,
            )
            return int((p.stdout or "0").strip()[:3] or 0)
        except Exception:
            return 0


def apply_sql(sql_path: Path) -> bool:
    r = subprocess.run(
        ["sg", "docker", "-c",
         f"docker cp {sql_path} arena-db:/tmp/daily.sql && "
         "docker exec arena-db psql -U arena -d arena -v ON_ERROR_STOP=1 -f /tmp/daily.sql"],
        capture_output=True, text=True, timeout=60,
    )
    return r.returncode == 0


def main() -> int:
    TMP.mkdir(parents=True, exist_ok=True)
    files = sorted(INGEST.glob("*.json"))
    ok, skip, fail = [], [], []
    for path in files:
        try:
            doc = json.loads(path.read_text())
        except Exception as e:
            fail.append(f"{path.stem}: bad json ({e})")
            continue
        pid = (doc.get("provider") or {}).get("id") or path.stem
        urls = doc.get("sources") or []
        if not urls:
            skip.append(f"{pid}: no source URL")
            continue
        code = probe(urls[0])
        if not (200 <= code < 400 or code == 403):
            fail.append(f"{pid}: source HTTP {code}")
            continue
        sql_out = TMP / f"{pid}.sql"
        gate = subprocess.run(
            [sys.executable, str(GATE), str(path), "-o", str(sql_out)],
            capture_output=True, text=True, timeout=30,
        )
        if gate.returncode != 0:
            fail.append(f"{pid}: gate rejected")
            continue
        if not apply_sql(sql_out):
            fail.append(f"{pid}: upsert failed")
            continue
        ok.append(f"{pid} ({code})")

    # Quiet on success so a 15-minute watchdog does not spam Telegram.
    if not fail:
        return 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"Cloud Directory refresh — {now}",
        f"OK {len(ok)} · gagal {len(fail)} · skip {len(skip)}",
        "Gagal: " + "; ".join(fail[:8]),
    ]
    if skip:
        lines.append("Skip: " + "; ".join(skip[:6]))
    print("\n".join(lines))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
