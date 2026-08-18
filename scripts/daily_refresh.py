#!/usr/bin/env python3
"""15-minute watchdog: refresh known files + ingest one uncovered provider.

Scrapes official price cards, named halls, and hypervisor only when written.
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
    return re.sub(r"\n+", "\n", t)


def parse_tiers(pid: str, html: str) -> list[dict]:
    text = visible_text(html)
    tiers: list[dict] = []
    for m in re.finditer(
        r"([A-Za-z0-9][^\n]{0,40}?)\s+(\d+)\s*vCPU[\s\S]{0,120}?RAM:\s*(\d+(?:\.\d+)?)\s*GB"
        r"[\s\S]{0,120}?(\d+)\s*GB\s*(SSD|NVMe)[\s\S]{0,500}?12 tháng\s*×\s*([\d\.]+)đ",
        text, re.I,
    ):
        amount = float(m.group(6).replace(".", ""))
        tname = m.group(1).strip()[:80]
        tid = re.sub(r"[^a-z0-9]+", "-", f"{pid}-{tname}").strip("-")[:80]
        tiers.append({
            "id": tid, "tier_name": tname, "vcpu": int(m.group(2)),
            "ram_gb": float(m.group(3)), "storage_gb": float(m.group(4)),
            "storage_type": m.group(5).upper(), "price_amount": amount,
            "currency": "VND", "price_native": f"{m.group(6)}đ /tháng (12 tháng)",
        })
    return tiers[:12]


def extra_pages(base: str, html: str) -> list[str]:
    found = []
    root = re.match(r"https?://[^/]+", base)
    if not root:
        return found
    blob = html.lower()
    for path in ("/pro-vps", "/cloud-vps/", "/vps", "/pricing", "/harga", "/cloud-server"):
        if path.rstrip("/") in blob:
            found.append(root.group(0) + path)
    return found[:4]


def named_halls(text: str, country: str) -> list[dict]:
    halls = []
    if re.search(r"The Cloud Tower", text, re.I) and country == "Thailand":
        halls.append({
            "name": "The Cloud Tower (Kaset-Nawamin)",
            "city": "Bangkok", "country": "Thailand",
            "operator": None, "source": None,
        })
    if re.search(r"NTT Jakarta", text, re.I) and country == "Indonesia":
        halls.append({
            "name": "NTT Jakarta", "city": "Jakarta", "country": "Indonesia",
            "operator": "NTT", "source": None,
        })
    return halls


def build_doc(row: dict, url: str, html: str) -> dict:
    pid = row["id"].strip()
    country = (row.get("country") or "").strip()
    name = (row.get("name") or pid).strip()
    pages = html
    for extra in extra_pages(url, html):
        code, body = fetch(extra)
        if 200 <= code < 400 and body:
            pages += "\n" + body
            if extra not in [url]:
                url = extra if "vps" in extra or "price" in extra or "harga" in extra else url
    tiers = parse_tiers(pid, pages)
    text = visible_text(pages)
    hv = "KVM" if re.search(r"\bKVM\b", text) else None
    if not hv and re.search(r"\bXen\b", text):
        hv = "Xen"
    halls = named_halls(text, country)
    cities = []
    if halls:
        cities = [{"city": h["city"], "country": h["country"]} for h in halls]
    else:
        for city, ctry in (
            ("Jakarta", "Indonesia"), ("Singapore", "Singapore"),
            ("Bangkok", "Thailand"), ("Hanoi", "Vietnam"),
            ("Manila", "Philippines"),
        ):
            if city.lower() in text.lower() and ctry == country:
                cities.append({"city": city, "country": ctry})
        if not cities:
            cities = [{"city": "Undisclosed", "country": country or "Undisclosed"}]
    dc_city = cities[0]["city"]
    dc_loc = halls[0]["name"] if halls else ("Undisclosed building" if dc_city == "Undisclosed" else dc_city)
    sources = [row["official_url"].strip()]
    if url not in sources:
        sources.append(url)
    return {
        "allow_no_tiers": not bool(tiers),
        "provider": {
            "id": pid, "name": name, "hq_country": country or None,
            "hq_city": None, "origin": "local" if country in ASEAN else "global",
            "provider_type": "IaaS", "is_local_asean": country in ASEAN,
            "website": row["official_url"].strip(), "legal_country": country or None,
            "legal_note": None,
        },
        "sources": sources,
        "stack": {"hypervisor": hv, "source_url": sources[-1]},
        "sovereignty": {"data_residency": "local" if country in ASEAN else "regional"},
        "locations": cities,
        "buildings_named": [{**h, "source": sources[-1]} for h in halls],
        "tiers": tiers,
        "dc_city": dc_city,
        "dc_country": country,
        "dc_location": dc_loc,
        "scraped_from": sources[-1],
        "notes": "Auto-ingest. SKUs/halls/hypervisor only if written on official pages.",
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
    hall = (doc.get("buildings_named") or [{}])
    hall_s = hall[0].get("name") if hall else None
    bits = [f"{n} paket"]
    if hall_s:
        bits.append(hall_s)
    if (doc.get("stack") or {}).get("hypervisor"):
        bits.append(doc["stack"]["hypervisor"])
    return f"Masuk Guide: {doc['provider']['name']} ({doc['provider']['hq_country']}) — {', '.join(bits)}. {url}"


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
            json.loads(path.read_text())
        except Exception as e:
            fail.append(f"{path.stem}: bad json ({e})")
            continue
        sql_out = TMP / f"{path.stem}.sql"
        gate = subprocess.run(
            [sys.executable, str(GATE), str(path), "-o", str(sql_out)],
            capture_output=True, text=True, timeout=30,
        )
        if gate.returncode != 0:
            fail.append(f"{path.stem}: gate rejected")
            continue
        if not apply_sql(sql_out):
            fail.append(f"{path.stem}: upsert failed")
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
