#!/usr/bin/env python3
"""Dispatch pending /correct requests to Redaksi Telegram.

Approve links for rescan. Claim verify links are NOT posted in the group
(that would skip mailbox proof). SMTP optional later.
"""
from __future__ import annotations

import json, subprocess, sys
from pathlib import Path

BOT = Path("/home/hermes-prime/arena-next/scripts/ciaworker_bot.py")
BASE = "https://guide.cloudin.asia"


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


def announce(text: str) -> None:
    subprocess.run(
        [sys.executable, str(BOT), "announce", text],
        check=False, timeout=30,
    )


def main() -> None:
    raw = sh(
        "SELECT json_agg(json_build_object("
        "'id',r.id,'kind',r.kind,'token',r.token,'email',r.requester_email,"
        "'provider_id',r.provider_id,'name',p.name) ORDER BY r.id) "
        "FROM correction_requests r JOIN providers p ON p.id=r.provider_id "
        "WHERE r.status='pending';"
    )
    if not raw:
        return
    rows = json.loads(raw) or []
    for row in rows:
        rid = int(row["id"])
        name = row["name"]
        if row["kind"] == "rescan":
            link = f"{BASE}/api/correct/approve?token={row['token']}"
            announce(
                f"Rescan diminta: {name}\n"
                f"Approve: {link}\n"
                f"1x/24j. First-party publik saja."
            )
        else:
            email = row.get("email") or "—"
            announce(
                f"Claim pending: {name}\n"
                f"Email: {email}\n"
                f"Tautan verifikasi hanya ke mailbox domain itu (bukan di grup)."
            )
        sh(f"UPDATE correction_requests SET status='notified' WHERE id={rid} AND status='pending';")


if __name__ == "__main__":
    main()
