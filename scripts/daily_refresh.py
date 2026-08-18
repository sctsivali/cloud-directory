#!/usr/bin/env python3
"""15-minute watchdog: refresh known files + ingest one uncovered provider.

Auto-ingest goes through the quality gate. Prices/halls are only stored
when they appear on the official page. Otherwise the provider is added
with Undisclosed building and no invented SKUs.
Silent when nothing new and refresh is healthy.
"""
from __future__ import annotations

import csv, json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/hermes-prime/arena-next")
INGEST = ROOT / "data" / "ingest"
GATE = ROOT / "scripts" / "ingest_provider.py"
CANDIDATES = ROOT / "data" / "uncovered-candidates.csv"
STATE = ROOT / "data" / ".discover-state.json"
TMP = Path("/tmp/cd-daily")
ASEAN = {
    "Indonesia", "Malaysia", "Singapore", "Thailand", "Vietnam",
    "Philippines", "Cambodia", "Laos", "Myanmar", "Brunei",
}


def fetch(url: str) -> tuple[int, str]:
    try:
        from curl_cffi import requests as r

        resp = r.get(url, impersonate="chrome124", timeout=18, allow_redirects=True)
        return int(resp.status_code), resp.text or ""
    except Exception:
        try:
            p = subprocess.run(
                ["curl", "-sL", "--max-time", "18", "-A",
                 "Mozilla/5.0 CloudDirectoryDaily/1.0", url],
                capture_output=True, text=True, timeout=22,
            )
            code_p = subprocess.run(
                ["curl", "-sI", "-L", "--max-time", "12", "-o", "/dev/null",
                 "-w", "%{http_code}", "-A", "Mozilla/5.0 CloudDirectoryDaily/1.0", url],
                capture_output=True, text=True, timeout=16,
            )
            code = int((code_p.stdout or "0").strip()[:3] or 0)
            return code, p.stdout or ""
        except Exception:
            return 0, ""


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
    return {"cursor": 0, "ingested": []}


def save_state(st: dict) -> None:
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n")


def visible_text(html: str) -> str:
    t = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    t = re.sub(r"<style[\s\S]*?</style>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n+", "\n", t)
    return t


def parse_tiers(pid: str, html: str) -> list[dict]:
    """Keep only complete public cards. Prefer none over a guess."""
    text = visible_text(html)
    tiers: list[dict] = []
    # "1 vCPU ... 2 GB ... 159 THB" style windows
    windows = re.split(r"\n{2,}", text)
    idx = 0
    for win in windows:
        m_cpu = re.search(r"(\d+)\s*vCPU", win, re.I)
        m_ram = re.search(r"(\d+(?:\.\d+)?)\s*(GB|MB)\s*(?:RAM|Memory)?", win, re.I)
        m_price = re.search(
            r"(?:Rp\.?|IDR|THB|VND|₱|PHP|\$|USD|฿)\s*([\d\.,]+)|([\d\.,]+)\s*(?:Rp|IDR|THB|VND|PHP|USD|/mo|/bulan|/tháng)",
            win, re.I,
        )
        if not (m_cpu and m_ram and m_price):
            continue
        ram = float(m_ram.group(1))
        if m_ram.group(2).upper() == "MB":
            ram = ram / 1024.0
        raw = (m_price.group(1) or m_price.group(2) or "").replace(",", "")
        try:
            amount = float(raw)
        except ValueError:
            continue
        if amount <= 0 or amount > 50_000_000:
            continue
        cur = "USD"
        if re.search(r"Rp|IDR", win, re.I):
            cur = "IDR"
        elif re.search(r"THB|฿", win, re.I):
            cur = "THB"
        elif re.search(r"VND|₫", win, re.I):
            cur = "VND"
        elif re.search(r"PHP|₱", win, re.I):
            cur = "PHP"
        name_m = re.search(r"(Cloud[^\n]{0,40}|VPS[^\n]{0,40}|Linux[^\n]{0,30})", win, re.I)
        idx += 1
        if idx > 12:
            break
        tname = (name_m.group(1).strip() if name_m else f"Plan {idx}")[:80]
        tid = re.sub(r"[^a-z0-9]+", "-", f"{pid}-{tname}-{idx}").strip("-")[:80]
        tiers.append({
            "id": tid,
            "tier_name": tname,
            "vcpu": int(m_cpu.group(1)),
            "ram_gb": ram,
            "price_amount": amount,
            "currency": cur,
            "price_native": f"{amount} {cur}",
        })
    # If parser is messy (too few fields in one blob) drop it
    if len(tiers) == 1 and tiers[0]["ram_gb"] < 0.25:
        return []
    return tiers


def build_doc(row: dict, url: str, html: str) -> dict:
    pid = row["id"].strip()
    country = (row.get("country") or "").strip()
    name = (row.get("name") or pid).strip()
    tiers = parse_tiers(pid, html)
    text = visible_text(html)
    hv = "KVM" if re.search(r"\bKVM\b", text) else None
    cities = []
    for city, ctry in (
        ("Jakarta", "Indonesia"), ("Singapore", "Singapore"),
        ("Bangkok", "Thailand"), ("Hanoi", "Vietnam"),
        ("Ho Chi Minh City", "Vietnam"), ("Manila", "Philippines"),
    ):
        if city.lower() in text.lower() and ctry == country:
            cities.append({"city": city, "country": ctry})
    if not cities:
        cities = [{"city": "Undisclosed", "country": country or "Undisclosed"}]
    dc_city = cities[0]["city"]
    return {
        "allow_no_tiers": not bool(tiers),
        "provider": {
            "id": pid,
            "name": name,
            "hq_country": country or None,
            "hq_city": None,
            "origin": "local" if country in ASEAN else "global",
            "provider_type": "IaaS",
            "is_local_asean": country in ASEAN,
            "website": url,
            "legal_country": country or None,
            "legal_note": None,
        },
        "sources": [url],
        "stack": {"hypervisor": hv, "source_url": url},
        "sovereignty": {"data_residency": "local" if country in ASEAN else "regional"},
        "locations": cities,
        "buildings": [],
        "tiers": tiers,
        "dc_city": dc_city,
        "dc_country": country,
        "dc_location": "Undisclosed building" if dc_city == "Undisclosed" else dc_city,
        "scraped_from": url,
        "notes": "Auto-ingest via 15m cron. No invented halls. SKUs only if parser saw a complete public card.",
    }


def ingest_row(row: dict) -> str | None:
    url = row["official_url"].strip()
    code, html = fetch(url)
    if not (200 <= code < 400 or code == 403) or not html:
        return None
    doc = build_doc(row, url, html)
    json_path = INGEST / f"{doc['provider']['id']}.json"
    json_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    sql_out = TMP / f"{doc['provider']['id']}.sql"
    TMP.mkdir(parents=True, exist_ok=True)
    gate = subprocess.run(
        [sys.executable, str(GATE), str(json_path), "-o", str(sql_out)],
        capture_output=True, text=True, timeout=30,
    )
    if gate.returncode != 0:
        json_path.unlink(missing_ok=True)
        return None
    if not apply_sql(sql_out):
        return None
    n = len(doc["tiers"])
    return (
        f"Masuk Guide: {doc['provider']['name']} ({doc['provider']['hq_country']}) "
        f"— {n} paket publik" + ("" if n else " (tanpa harga, gedung Undisclosed)")
        + f". {url}"
    )


def hunt_and_ingest() -> str | None:
    if not CANDIDATES.exists():
        return None
    rows = [r for r in csv.DictReader(CANDIDATES.open()) if r.get("id") and r.get("official_url")]
    if not rows:
        return None
    ids, names = db_index()
    st = load_state()
    start = int(st.get("cursor") or 0) % len(rows)
    picked = None
    for i in range(len(rows)):
        row = rows[(start + i) % len(rows)]
        pid = row["id"].strip().lower()
        name = (row.get("name") or pid).strip().lower()
        if pid in ids or name in names:
            continue
        picked = (start + i) % len(rows), row
        break
    if not picked:
        st["cursor"] = (start + 1) % len(rows)
        save_state(st)
        return None
    idx, row = picked
    msg = ingest_row(row)
    st["cursor"] = (idx + 1) % len(rows)
    if msg:
        ingested = set(st.get("ingested") or [])
        ingested.add(row["id"].strip())
        st["ingested"] = sorted(ingested)
    save_state(st)
    return msg


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
        code, _ = fetch(urls[0])
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
    added = hunt_and_ingest()
    if not fail and not added:
        return 0
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"Cloud Directory 15m — {now}"]
    if added:
        lines.append(added)
    if fail:
        lines.append("Gagal refresh: " + "; ".join(fail[:8]))
    print("\n".join(lines))
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
