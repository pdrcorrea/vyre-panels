import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import feedparser

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "data" / "news_sources.json"
OUT_PATH = ROOT / "data" / "news.json"

# Filtro “soft”
BLOCKLIST = [
    "morte","morto","assassin","homic","crime","violên","tirote","trág","trag",
    "estupro","roubo","furto","sequestro","corpo",
    "política","eleição","partido","corrup","escând",
    "acidente grave","desastre","catástro","explos"
]

# Preferência (utilidade pública)
PREFER = ["evento","aviso","mutirão","vacinação","saúde","trânsito","obra","feira","cultura","educação","serviço","atendimento"]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def is_blocked(title: str, summary: str) -> bool:
    hay = (title + " " + summary).lower()
    return any(w in hay for w in BLOCKLIST)

def score_prefer(title: str, summary: str) -> int:
    hay = (title + " " + summary).lower()
    return sum(1 for w in PREFER if w in hay)

def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "PontoViewBot/1.0 (GitHub Actions)"})
    with urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")

def dt_to_iso(entry) -> str:
    # feedparser pode retornar published_parsed/updated_parsed (struct_time)
    for k in ("published_parsed", "updated_parsed"):
        if getattr(entry, k, None):
            try:
                return datetime(*getattr(entry, k)[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass
    # fallback: strings
    for k in ("published", "updated"):
        v = entry.get(k)
        if v:
            return v
    return ""

def parse_feed(content: str, source_name: str):
    fp = feedparser.parse(content)
    items = []

    for e in fp.entries:
        title = strip_html(e.get("title", "")).strip()
        link = (e.get("link") or "").strip()

        summary = e.get("summary", "") or e.get("description", "") or ""
        summary = strip_html(summary)

        if not title:
            continue
        if is_blocked(title, summary):
            continue

        short = summary[:220].rstrip()
        if len(summary) > 220:
            short += "…"

        published_at = dt_to_iso(e)

        stable = (link or title).encode("utf-8", errors="ignore")
        _id = f"{abs(hash(stable))}"

        items.append({
            "id": f"{source_name}:{_id}",
            "title": title,
            "summary": short,
            "source": source_name,
            "publishedAt": published_at,
            "url": link
        })

    return items

def main():
    if not SOURCES_PATH.exists():
        print("Missing data/news_sources.json", file=sys.stderr)
        sys.exit(1)

    src_cfg = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    sources = src_cfg.get("sources", [])

    all_items = []
    failures = 0

    for s in sources:
        name = s.get("name", "Fonte")
        rss = s.get("rss")
        if not rss:
            continue
        try:
            content = fetch(rss)
            all_items.extend(parse_feed(content, name))
        except Exception as e:
            failures += 1
            print(f"[warn] failed {name}: {e}", file=sys.stderr)

    def sort_key(it):
        score = score_prefer(it.get("title",""), it.get("summary",""))
        pub = it.get("publishedAt") or ""
        return (-score, pub)

    all_items.sort(key=sort_key)

    payload = {
        "generatedAt": now_iso(),
        "items": all_items[:80],
        "stats": {
            "sources": len(sources),
            "failures": failures,
            "items": len(all_items)
        }
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(payload['items'])} items (sources={len(sources)} failures={failures})")

if __name__ == "__main__":
    main()
