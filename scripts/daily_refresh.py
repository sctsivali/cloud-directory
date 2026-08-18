#!/usr/bin/env python3
"""15-minute watchdog: refresh known ingest JSON + hunt 1 uncovered provider.

Does not invent prices or halls. Does not truncate. Does not auto-insert.
Silent when nothing changed and nothing new was found.
"""
from __future__ import annotations

import csv, json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/hermes-prime/arena-next")
INGEST = ROOT / "data" / "ingest"
GATE = ROOT / "scripts" / "ingest_provider.py"
CANDIDATES = ROOT / "data" / "uncovered-candidates.csv"
STATE = ROOT / "data" / ".discover-state.json"
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


def db_index() -> tuple[set[str], set[str]]:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec arena-db psql -U arena -d arena -At -F '|' -c "
         "\"SELECT lower(id), lower(name) FROM providers;\""],
        capture_output=True, text=True, timeout=20,
    )
    ids, names = set(), set()
    for line in (r.stdout or "").splitlines():
        if "|" not in line:
            continue
        i, n = line.split("|", 1)
        ids.add(i.strip())
        names.add(n.strip())
    return ids, names


def load_state() -> dict:
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {"cursor": 0, "reported": []}


def save_state(st: dict) -> None:
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n")


def hunt_one() -> str | None:
    if not CANDIDATES.exists():
        return None
    rows = [r for r in csv.DictReader(CANDIDATES.open()) if r.get("id") and r.get("official_url")]
    if not rows:
        return None
    ids, names = db_index()
    st = load_state()
    reported = set(st.get("reported") or [])
    start = int(st.get("cursor") or 0) % len(rows)
    picked = None
    for i in range(len(rows)):
        row = rows[(start + i) % len(rows)]
        pid = row["id"].strip().lower()
        name = (row.get("name") or pid).strip().lower()
        if pid in ids or name in names:
            continue
        if row["id"].strip() in reported:
            continue
        picked = (start + i) % len(rows), row
        break
    st["cursor"] = (start + 1) % len(rows)
    if not picked:
        save_state(st)
        return None
    idx, row = picked
    pid = row["id"].strip()
    code = probe(row["official_url"].strip())
    if not (200 <= code < 400 or code == 403):
        save_state(st)
        return None
    reported.add(pid)
    st["reported"] = sorted(reported)
    st["cursor"] = (idx + 1) % len(rows)
    save_state(st)
    return (
        f"Belum ke-cover: {row.get('name')} ({row.get('country')}) "
        f"{row.get('official_url')} HTTP {code} — belum diingest, harga/gedung tidak dikarang."
    )


def refresh_known() -> list[str]:
    fail: list[str] = []
    TMP.mkdir(parents=True, exist_ok=True)
    for path in sorted(INGEST.glob("*.json")):
        try:
            doc = json.loads(path.read_text())
        except Exception as e:
            fail.append(f"{path.stem}: bad json ({e})")
            continue
        pid = (doc.get("provider") or {}).get("id") or path.stem
        urls = doc.get("sources") or []
        if not urls:
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
    return fail


def main() -> int:
    fail = refresh_known()
    found = hunt_one()
    if not fail and not found:
        return 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"Cloud Directory 15m — {now}"]
    if fail:
        lines.append("Gagal refresh: " + "; ".join(fail[:8]))
    if found:
        lines.append(found)
    print("\n".join(lines))
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
