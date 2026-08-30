#!/usr/bin/env python3
"""CIA Guide ops bot (@ciaworker_bot): queue reports + Approve/Reject.

Not a chat agent. Token: ~/.hermes/ciaworker.token (chmod 600).
Allowlist: ~/.hermes/ciaworker.allowlist (Telegram user IDs).
Notify target: /sethome in the ops group.
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


def in_home_group(chat_id: int | str) -> bool:
    home = home_chat()
    return home is not None and int(chat_id) == int(home)


def ops_ok(uid: int | str, chat_id: int | str) -> bool:
    """Anyone in the sethome group; otherwise allowlisted DMs only."""
    if in_home_group(chat_id):
        return True
    return authorized(uid)


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


def actor_label(user: dict) -> str:
    first = (user.get("first_name") or "").strip()
    last = (user.get("last_name") or "").strip()
    name = " ".join(p for p in (first, last) if p) or "seseorang"
    uname = (user.get("username") or "").strip()
    uid = user.get("id") or ""
    if uname:
        return f"{name} (@{uname})"
    return f"{name} (id {uid})"


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


def home_chat() -> int | None:
    if not CHAT_PATH.exists():
        return None
    raw = CHAT_PATH.read_text().strip()
    return int(raw) if raw.lstrip("-").isdigit() else None


def handle_message(tok: str, msg: dict) -> None:
    user = msg.get("from") or {}
    uid = user.get("id") or 0
    chat = msg.get("chat") or {}
    text = (msg.get("text") or "").strip()
    cmd = text.split()[0].split("@")[0].lower() if text else ""
    chat_id = int(chat.get("id") or 0)

    if cmd == "/whoami":
        tg(tok, "sendMessage", {
            "chat_id": chat_id,
            "text": f"id kamu: {uid}",
        })
        return

    if not ops_ok(uid, chat_id):
        return

    if cmd in ("/start", "/help"):
        tg(tok, "sendMessage", {
            "chat_id": chat_id,
            "text": (
                "CIA Guide ops. Bukan agen ngobrol.\n"
                "/sethome — laporan crawl ke chat ini (grup Redaksi)\n"
                "/queue — antrian discovered + needs_review\n"
                "/whoami — ID Telegram (untuk allowlist tim)\n"
                "Tombol: Approve crawl / Tolak / Masuk Guide / Buang"
            ),
        })
        return
    if cmd == "/sethome":
        if not authorized(uid):
            return
        remember_chat(chat_id)
        kind = chat.get("type") or "?"
        title = chat.get("title") or "DM"
        tg(tok, "sendMessage", {
            "chat_id": chat_id,
            "text": f"Home ops: {title} ({kind}). Laporan crawl ke sini.",
        })
        return
    if cmd == "/queue":
        rows = pending_cards()
        tg(tok, "sendMessage", {"chat_id": chat_id, "text": queue_summary()})
        for row in rows[:10]:
            payload = {"chat_id": chat_id, "text": card(row)}
            kb = kb_for(int(row["id"]), row["status"])
            if kb:
                payload["reply_markup"] = kb
            tg(tok, "sendMessage", payload)
        return


def announce_home(tok: str, text: str) -> None:
    hid = home_chat()
    if hid is None:
        raise SystemExit("no home chat")
    tg(tok, "sendMessage", {"chat_id": hid, "text": text, "disable_web_page_preview": True})


def handle_callback(tok: str, cq: dict) -> None:
    user = cq.get("from") or {}
    uid = user.get("id") or 0
    data = cq.get("data") or ""
    cid = cq.get("id")
    msg = cq.get("message") or {}
    chat_id = int((msg.get("chat") or {}).get("id") or 0)
    if not ops_ok(uid, chat_id):
        tg(tok, "answerCallbackQuery", {"callback_query_id": cid, "text": "tidak diizinkan"})
        return
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "q":
        tg(tok, "answerCallbackQuery", {"callback_query_id": cid, "text": "payload rusak"})
        return
    rid, status = int(parts[1]), parts[2]
    who = actor_label(user)
    verb = {
        "queued": "Approve crawl",
        "ingested": "Masuk Guide",
        "rejected": "Tolak",
    }.get(status, status)
    row = set_status(rid, status, reason=f"{verb} oleh {who}")
    tg(tok, "answerCallbackQuery", {"callback_query_id": cid, "text": f"{verb} · {who}"})
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
    if row and status in ("queued", "ingested"):
        site = row.get("website") or ""
        extra = "\nhttps://guide.cloudin.asia/updates" if status == "ingested" else ""
        announce_home(tok, (
            f"{verb}: {row['name']}\n"
            f"{site}\n"
            f"oleh {who}"
            f"{extra}"
        ))


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
    last = None
    for attempt in range(3):
        try:
            tg(tok, "sendMessage", payload)
            psql(f"UPDATE provider_pipeline SET notified_at=now() WHERE id={int(rid)};")
            return
        except Exception as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"notify {rid} failed: {type(last).__name__}")


def notify_pending(tok: str) -> None:
    out = psql(
        "SELECT id FROM provider_pipeline WHERE notified_at IS NULL ORDER BY id LIMIT 10;"
    )
    for line in out.splitlines():
        if line.strip().isdigit():
            notify_row(tok, int(line.strip()))


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
    if len(sys.argv) >= 2 and sys.argv[1] == "notify-pending":
        notify_pending(tok)
        return
    if len(sys.argv) >= 3 and sys.argv[1] == "announce":
        announce_home(tok, " ".join(sys.argv[2:]))
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
