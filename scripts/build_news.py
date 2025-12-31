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

BLOCKLIST = [
    "morte","morto","assassin","homic","crime","violên","tirote","trág","trag",
    "estupro","roubo","furto","sequestro","corpo",
    "política","eleição","partido","corrup","escând",
    "acidente grave","desastre","catástro","explos"
]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def is_blocked(title: str, summary: str) -> bool:
    hay = (title + " " + summary).lower()
    return any(w in hay for w in BLOCKLIST)

def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "PontoViewBot/1.0 (GitHub Actions)"})
    with urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")

def dt_to_iso(entry) -> str:
    for k in ("published_parsed", "updated_parsed"):
        v = getattr(entry, k, None)
        if v:
            try:
                return datetime(*v[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass
    for k in ("published", "updated"):
        v = entry.get(k)
        if v:
            return str(v)
    return ""

def parse_feed(content: str, source_name: str):
    fp = feedparser.parse(content)
    items = []
    for e in fp.entries:
        title = strip_html(e.get("title", "")).strip()
        link = (e.get("link") or "").strip()
        summary = strip_html(e.get("summary", "") or e.get("description", "") or "")

        if not title:
            continue
        if is_blocked(title, summary):
            continue

        short = summary[:220].rstrip() + ("…" if len(summary) > 220 else "")
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

def extract_image(entry):
    # media_content (RSS)
    media = entry.get("media_content")
    if media and isinstance(media, list):
        return media[0].get("url")

    # media_thumbnail
    thumb = entry.get("media_thumbnail")
    if thumb and isinstance(thumb, list):
        return thumb[0].get("url")

    # imagem dentro do summary (Google News)
    summary = entry.get("summary", "") or entry.get("description", "")
    m = re.search(r'<img[^>]+src="([^">]+)"', summary)
    if m:
        return m.group(1)

    return None


def main():
    if not SOURCES_PATH.exists():
        OUT_PATH.write_text(json.dumps({"generatedAt": now_iso(), "items": [], "stats": {"error":"missing data/news_sources.json"}}, ensure_ascii=False, indent=2), encoding="utf-8")
        sys.exit(0)

    cfg = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    sources = cfg.get("sources", [])

    all_items = []
    per_source = []
    failures = []

    for s in sources:
        name = s.get("name", "Fonte")
        rss = s.get("rss")
        if not rss:
            failures.append({"source": name, "error": "missing rss url"})
            continue
        try:
            content = fetch(rss)
            items = parse_feed(content, name)
            per_source.append({"source": name, "count": len(items)})
            all_items.extend(items)
        except Exception as e:
            failures.append({"source": name, "rss": rss, "error": str(e)})

    payload = {
        "generatedAt": now_iso(),
        "items": all_items[:80],
        "stats": {
            "sources": len(sources),
            "items_before_limit": len(all_items),
            "per_source": per_source,
            "failures": failures
        }
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(payload['items'])} items")

if __name__ == "__main__":
    main()
