#!/usr/bin/env python3
"""CIA Guide ops bot (@ciaworker_bot): queue reports + Approve/Reject.

Not a chat agent. Ryo-only. Token: ~/.hermes/ciaworker.token (chmod 600).
Silent unless there is queue work or a command.
"""
from __future__ import annotations

import json, os, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

HOME = Path("/home/hermes-prime/.hermes")
TOKEN_PATH = HOME / "ciaworker.token"
ALLOW_PATH = HOME / "ciaworker.allowlist"
CHAT_PATH = HOME / "ciaworker.chat_id"
API = "https://api.telegram.org/bot{token}/{method}"
STATUSES = ("discovered", "queued", "crawling", "needs_review", "ingested", "rejected")


def token() -> str:
    t = TOKEN_PATH.read_text().strip() if TOKEN_PATH.exists() else ""
    if not t or ":" not in t:
        raise SystemExit("missing ~/.hermes/ciaworker.token")
    return t


def allow() -> set[str]:
    if not ALLOW_PATH.exists():
        return set()
    return {ln.strip() for ln in ALLOW_PATH.read_text().splitlines() if ln.strip()}


def psql(sql: str) -> str:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=20,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-400:] or r.stdout[-400:])
    return r.stdout.strip()


def esc(s: str) -> str:
    return (s or "").replace("'", "''")


def tg(tok: str, method: str, payload: dict) -> dict:
    url = API.format(token=tok, method=method)
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode())


def authorized(uid: int | str) -> bool:
    return str(uid) in allow()


def kb_for(row_id: int, status: str) -> dict | None:
    if status == "discovered":
        rows = [[
            {"text": "Approve crawl", "callback_data": f"q:{row_id}:queued"},
            {"text": "Tolak", "callback_data": f"q:{row_id}:rejected"},
        ]]
    elif status == "needs_review":
        rows = [[
            {"text": "Masuk Guide", "callback_data": f"q:{row_id}:ingested"},
            {"text": "Buang", "callback_data": f"q:{row_id}:rejected"},
        ]]
    else:
        return None
    return {"inline_keyboard": rows}


def card(row: dict) -> str:
    return (
        f"#{row['id']}  {row['name']}\n"
        f"{row.get('website') or '—'}\n"
        f"{row.get('country') or '—'}\n"
        f"flag: {row['status']}"
        + (f"\n{row['reason']}" if row.get("reason") else "")
    )


def load_row(rid: int) -> dict | None:
    out = psql(
        "SELECT json_build_object('id',id,'name',name,'website',website,"
        "'country',country,'status',status,'reason',reason) "
        f"FROM provider_pipeline WHERE id={int(rid)};"
    )
    if not out:
        return None
    return json.loads(out)


def set_status(rid: int, status: str, reason: str = "") -> dict | None:
    if status not in STATUSES:
        return None
    psql(
        "UPDATE provider_pipeline SET status='"
        + esc(status)
        + "', reason='"
        + esc(reason)
        + "', updated_at=now() WHERE id="
        + str(int(rid))
        + ";"
    )
    return load_row(rid)


def queue_summary() -> str:
    out = psql(
        "SELECT status||' '||count(*) FROM provider_pipeline "
        "GROUP BY status ORDER BY status;"
    )
    if not out:
        return "Antrian kosong."
    return "Antrian:\n" + "\n".join(out.splitlines())


def pending_cards() -> list[dict]:
    out = psql(
        "SELECT json_agg(json_build_object('id',id,'name',name,'website',website,"
        "'country',country,'status',status,'reason',reason) ORDER BY id) "
        "FROM provider_pipeline WHERE status IN ('discovered','needs_review');"
    )
    if not out or out == "":
        return []
    data = json.loads(out)
    return data or []


def remember_chat(chat_id: int) -> None:
    CHAT_PATH.write_text(str(int(chat_id)) + "\n")
    CHAT_PATH.chmod(0o600)


def handle_message(tok: str, msg: dict) -> None:
    user = msg.get("from") or {}
    uid = user.get("id") or 0
    chat = msg.get("chat") or {}
    text = (msg.get("text") or "").strip()
    if not authorized(uid):
        return
    remember_chat(int(chat["id"]))
    cmd = text.split()[0].split("@")[0].lower() if text else ""
    if cmd in ("/start", "/help"):
        tg(tok, "sendMessage", {
            "chat_id": chat["id"],
            "text": (
                "CIA Guide ops. Bukan agen ngobrol.\n"
                "/queue — antrian discovered + needs_review\n"
                "Tombol: Approve crawl / Tolak / Masuk Guide / Buang"
            ),
        })
        return
    if cmd == "/queue":
        rows = pending_cards()
        tg(tok, "sendMessage", {"chat_id": chat["id"], "text": queue_summary()})
        for row in rows[:10]:
            payload = {"chat_id": chat["id"], "text": card(row)}
            kb = kb_for(int(row["id"]), row["status"])
            if kb:
                payload["reply_markup"] = kb
            tg(tok, "sendMessage", payload)
        return


def handle_callback(tok: str, cq: dict) -> None:
    user = cq.get("from") or {}
    uid = user.get("id") or 0
    data = cq.get("data") or ""
    cid = cq.get("id")
    msg = cq.get("message") or {}
    if not authorized(uid):
        tg(tok, "answerCallbackQuery", {"callback_query_id": cid, "text": "tidak diizinkan"})
        return
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "q":
        tg(tok, "answerCallbackQuery", {"callback_query_id": cid, "text": "payload rusak"})
        return
    rid, status = int(parts[1]), parts[2]
    row = set_status(rid, status, reason=f"via ciaworker by {uid}")
    tg(tok, "answerCallbackQuery", {"callback_query_id": cid, "text": status})
    if row and msg.get("chat"):
        payload = {
            "chat_id": msg["chat"]["id"],
            "message_id": msg["message_id"],
            "text": card(row),
        }
        kb = kb_for(int(row["id"]), row["status"])
        if kb:
            payload["reply_markup"] = kb
        tg(tok, "editMessageText", payload)


def notify_row(tok: str, rid: int) -> None:
    if not CHAT_PATH.exists():
        raise SystemExit("no chat_id yet — Ryo must /start @ciaworker_bot first")
    chat_id = int(CHAT_PATH.read_text().strip())
    row = load_row(rid)
    if not row:
        raise SystemExit(f"no pipeline row {rid}")
    payload = {"chat_id": chat_id, "text": card(row)}
    kb = kb_for(int(row["id"]), row["status"])
    if kb:
        payload["reply_markup"] = kb
    tg(tok, "sendMessage", payload)
    psql(f"UPDATE provider_pipeline SET notified_at=now() WHERE id={int(rid)};")


def loop(tok: str) -> None:
    offset = 0
    while True:
        try:
            res = tg(tok, "getUpdates", {
                "offset": offset,
                "timeout": 50,
                "allowed_updates": ["message", "callback_query"],
            })
            for upd in res.get("result") or []:
                offset = int(upd["update_id"]) + 1
                if "message" in upd:
                    handle_message(tok, upd["message"])
                if "callback_query" in upd:
                    handle_callback(tok, upd["callback_query"])
        except Exception as exc:
            time.sleep(3)
            # keep running; do not print token
            print(f"ciaworker loop: {type(exc).__name__}", file=sys.stderr, flush=True)


def main() -> None:
    import sys
    tok = token()
    if len(sys.argv) >= 3 and sys.argv[1] == "notify":
        notify_row(tok, int(sys.argv[2]))
        return
    if len(sys.argv) >= 2 and sys.argv[1] == "queue":
        print(queue_summary())
        return
    me = tg(tok, "getMe", {})
    uname = ((me.get("result") or {}).get("username") or "")
    if uname.lower() != "ciaworker_bot":
        raise SystemExit(f"token is not @ciaworker_bot (got @{uname or '?'})")
    loop(tok)


if __name__ == "__main__":
    main()
