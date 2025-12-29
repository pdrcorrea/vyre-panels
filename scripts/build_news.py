import json
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "data" / "news_sources.json"
OUT_PATH = ROOT / "data" / "news.json"

# Filtro “soft” — bloqueia temas pesados
BLOCKLIST = [
    "morte","morto","assassin","homic","crime","violên","tirote","trág","trag",
    "estupro","roubo","furto","sequestro","corpo",
    "política","eleição","partido","corrup","escând",
    "acidente grave","desastre","catástro","explos"
]

# Preferência — dá prioridade para utilidade pública/eventos/serviços
PREFER = ["evento","aviso","mutirão","vacinação","saúde","trânsito","obra","feira","cultura","educação","serviço","atendimento"]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "PontoViewBot/1.0 (GitHub Actions)"})
    with urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", errors="ignore")

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

def parse_pubdate(s: str):
    if not s:
        return ""
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return ""

def parse_rss(xml: str, source_name: str):
    items = []
    for m in re.finditer(r"<item\b.*?>.*?</item>", xml, flags=re.S | re.I):
        item = m.group(0)

        def get(tag):
            mm = re.search(rf"<{tag}\b.*?>(.*?)</{tag}>", item, flags=re.S | re.I)
            return mm.group(1).strip() if mm else ""

        title = strip_html(get("title"))
        link = strip_html(get("link"))
        desc = strip_html(get("description") or get("content:encoded"))
        pub = parse_pubdate(strip_html(get("pubDate")))

        if not title:
            continue
        if is_blocked(title, desc):
            continue

        summary = desc[:220].rstrip()
        if len(desc) > 220:
            summary += "…"

        stable = (link or title).encode("utf-8", errors="ignore")
        _id = f"{abs(hash(stable))}"

        items.append({
            "id": f"{source_name}:{_id}",
            "title": title,
            "summary": summary,
            "source": source_name,
            "publishedAt": pub,
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
    for s in sources:
        name = s.get("name", "Fonte")
        rss = s.get("rss")
        if not rss:
            continue
        try:
            xml = fetch(rss)
            all_items.extend(parse_rss(xml, name))
        except Exception as e:
            print(f"[warn] failed {name}: {e}", file=sys.stderr)

    # Ordena por preferência e data (quando existir)
    def sort_key(it):
        score = score_prefer(it.get("title",""), it.get("summary",""))
        pub = it.get("publishedAt") or ""
        return (-score, pub)

    all_items.sort(key=sort_key)

    payload = {
        "generatedAt": now_iso(),
        "items": all_items[:80]
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(payload['items'])} items")

if __name__ == "__main__":
    main()
