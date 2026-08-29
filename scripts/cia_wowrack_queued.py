#!/usr/bin/env python3
"""Process one provider_pipeline row with status=queued.

Full-site first-party fetch. Writes a draft JSON. Does NOT ingest Guide.
Moves row to needs_review and notifies the ops group. Silent if queue empty.
"""
from __future__ import annotations

import json, re, subprocess, sys, html as htmlmod
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path("/home/hermes-prime/arena-next")
DRAFT = ROOT / "data" / "ingest" / "pipeline"
BOT = ROOT / "scripts" / "ciaworker_bot.py"
STACK_RE = re.compile(
    r"\b(KVM|Xen|Proxmox|OpenStack|Kubernetes|K8s|KubeRaya|Ceph|MinIO|S3|Docker)\b",
    re.I,
)


def sh(sql: str) -> str:
    r = subprocess.run(
        ["sg", "docker", "-c",
         "docker exec -i arena-db psql -U arena -d arena -tA -v ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, timeout=20,
    )
    if r.returncode != 0:
        print(r.stderr[-400:], file=sys.stderr)
        raise SystemExit(1)
    return r.stdout.strip()


def esc(s: str) -> str:
    return (s or "").replace("'", "''")


def fetch(url: str) -> tuple[int, str, str]:
    try:
        from curl_cffi import requests as r
        resp = r.get(url, impersonate="chrome124", timeout=18, allow_redirects=True)
        return int(resp.status_code), str(resp.url), resp.text or ""
    except Exception as e:
        return 0, url, str(e)[:180]


def vis(body: str) -> str:
    nos = re.sub(r"<script[^>]*>.*?</script>", " ", body, flags=re.S | re.I)
    nos = re.sub(r"<style[^>]*>.*?</style>", " ", nos, flags=re.S | re.I)
    t = htmlmod.unescape(re.sub(r"<[^>]+>", " ", nos))
    return re.sub(r"\s+", " ", t)


def extra_urls(base: str, body: str) -> list[str]:
    host = urlparse(base).netloc
    found = []
    for href in re.findall(r'href=["\']([^"\']+)', body, re.I):
        u = urljoin(base, href).split("#")[0]
        if urlparse(u).netloc != host:
            continue
        if re.search(r"harga|pricing|vps|cloud-server|public-cloud|about|docs|feature|faq", u, re.I):
            if u not in found:
                found.append(u)
    return found[:12]


def quotes(text: str) -> list[str]:
    out = []
    for m in STACK_RE.finditer(text):
        i = m.start()
        snip = text[max(0, i - 60): i + 90].strip()
        if snip not in out:
            out.append(snip)
        if len(out) >= 12:
            break
    return out


def main() -> None:
    raw = sh(
        "SELECT json_build_object('id',id,'name',name,'website',website,'country',country) "
        "FROM provider_pipeline WHERE status='queued' ORDER BY id LIMIT 1;"
    )
    if not raw:
        return
    row = json.loads(raw)
    rid = int(row["id"])
    url = row.get("website") or ""
    sh(f"UPDATE provider_pipeline SET status='crawling', updated_at=now() WHERE id={rid};")
    pages = []
    st, final, body = fetch(url)
    pages.append({"url": final, "status": st, "text": vis(body)[:8000] if st else body[:500]})
    if st and body:
        for extra in extra_urls(final, body):
            s2, f2, b2 = fetch(extra)
            pages.append({"url": f2, "status": s2, "text": vis(b2)[:5000] if s2 else b2[:300]})
    all_text = " ".join(p.get("text") or "" for p in pages)
    q = quotes(all_text)
    has_price = bool(re.search(r"(/bulan|/month|฿\s*/\s*mo|THB|Rp\s*\d)", all_text, re.I))
    draft = {
        "pipeline_id": rid,
        "name": row["name"],
        "website": url,
        "country": row.get("country"),
        "pages": [{"url": p["url"], "status": p["status"]} for p in pages],
        "stack_quotes": q,
        "price_words_seen": has_price,
        "note": "Draft only. Not ingested. Hypervisor null unless a public-cloud VM page names it.",
    }
    DRAFT.mkdir(parents=True, exist_ok=True)
    path = DRAFT / f"{rid}.json"
    path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n")
    reason = (
        f"Wowrack draft {path.name}. quotes={len(q)} price_words={has_price}. "
        "Not in Guide until Masuk Guide + gate."
    )
    payload = json.dumps({"draft": str(path), "stack_quotes": q})
    sh(
        f"UPDATE provider_pipeline SET status='needs_review', reason='{esc(reason)}', "
        f"payload='{esc(payload)}'::jsonb, updated_at=now() WHERE id={rid};"
    )
    subprocess.run([sys.executable, str(BOT), "notify", str(rid)], check=False, timeout=30)


if __name__ == "__main__":
    main()
