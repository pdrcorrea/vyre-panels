// scripts/build_news.mjs
// Gera ./data/news.json a partir de fontes RSS/Atom.
// Objetivo: entregar itens com { title, url, imageUrl, source, publishedAt, scope, city }
// Sem dependências externas (Node 20+).

import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "news.json");

// Config
const MAX_AGE_DAYS = 3;          // só notícias até N dias atrás
const MAX_ITEMS_TOTAL = 36;      // total no JSON
const MAX_PER_SOURCE = 12;       // por fonte (após filtrar)
const FETCH_TIMEOUT_MS = 20000;

// Onde buscar as fontes
const SOURCES_CANDIDATES = [
  path.join(OUT_DIR, "news_sources.json"),
  "news_sources.json",
];

// ----------------------------- helpers -----------------------------

function nowMs() { return Date.now(); }

function daysToMs(days) { return days * 24 * 60 * 60 * 1000; }

function stripTags(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s = "") {
  // decodificação leve o suficiente p/ títulos de RSS
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function clampStr(s, max = 220) {
  const t = String(s || "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function safeUrl(u) {
  try { return new URL(u).toString(); } catch { return null; }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Pontoview News Builder (+https://pontoview.com.br)",
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function firstMatch(re, s) {
  const m = re.exec(s);
  return m ? m[1] : null;
}

function attr(name, tag) {
  // extrai atributo dentro de um pedaço de tag (ex: <media:content url="...">)
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return firstMatch(re, tag);
}

function getTagContent(xml, tagName) {
  // pega o primeiro <tagName>...</tagName>
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return firstMatch(re, xml);
}

function getAllBlocks(xml, blockName) {
  const re = new RegExp(`<${blockName}\\b[\\s\\S]*?<\\/${blockName}>`, "gi");
  return Array.from(xml.matchAll(re), m => m[0]);
}

function extractLinkFromItem(itemXml) {
  // RSS: <link>...</link>
  const rssLink = getTagContent(itemXml, "link");
  if (rssLink) return decodeEntities(stripTags(rssLink));

  // Atom: <link href="..."/> ou <link rel="alternate" href="..."/>
  const links = Array.from(itemXml.matchAll(/<link\b[^>]*>/gi), m => m[0]);
  if (links.length) {
    const alt = links.find(t => /rel\s*=\s*["']alternate["']/i.test(t)) || links[0];
    const href = attr("href", alt);
    if (href) return decodeEntities(href);
  }
  return null;
}

function extractPublishedAt(itemXml) {
  const candidates = [
    getTagContent(itemXml, "pubDate"),
    getTagContent(itemXml, "published"),
    getTagContent(itemXml, "updated"),
    getTagContent(itemXml, "dc:date"),
  ].filter(Boolean);

  for (const raw of candidates) {
    const t = decodeEntities(stripTags(raw));
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function extractImageUrl(itemXml) {
  // 1) <media:content url="...">
  const mediaContent = firstMatch(/<media:content\b[^>]*>/i, itemXml);
  if (mediaContent) {
    const u = attr("url", mediaContent);
    if (u) return decodeEntities(u);
  }

  // 2) <media:thumbnail url="...">
  const mediaThumb = firstMatch(/<media:thumbnail\b[^>]*>/i, itemXml);
  if (mediaThumb) {
    const u = attr("url", mediaThumb);
    if (u) return decodeEntities(u);
  }

  // 3) <enclosure url="..." type="image/jpeg">
  const enclosure = firstMatch(/<enclosure\b[^>]*>/i, itemXml);
  if (enclosure) {
    const type = attr("type", enclosure) || "";
    const u = attr("url", enclosure);
    if (u && (/^image\//i.test(type) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u))) {
      return decodeEntities(u);
    }
  }

  // 4) descrição com <img src="..."> (Google News e vários CMS)
  const desc =
    getTagContent(itemXml, "description") ||
    getTagContent(itemXml, "content:encoded") ||
    getTagContent(itemXml, "content");
  if (desc) {
    const html = decodeEntities(desc);
    const img = firstMatch(/<img[^>]+src=["']([^"']+)["']/i, html);
    if (img) return decodeEntities(img);
  }

  return null;
}

function extractTitle(itemXml) {
  const t = getTagContent(itemXml, "title") || getTagContent(itemXml, "atom:title");
  if (!t) return null;
  // título pode vir com entidades e HTML dentro (Google News)
  return clampStr(decodeEntities(stripTags(t)), 220);
}

function parseFeed(xmlText) {
  const xml = String(xmlText || "");

  // RSS: <item>...</item>
  let blocks = getAllBlocks(xml, "item");
  let isAtom = false;

  // Atom: <entry>...</entry>
  if (blocks.length === 0) {
    blocks = getAllBlocks(xml, "entry");
    isAtom = true;
  }

  const out = [];
  for (const b of blocks) {
    const title = extractTitle(b);
    const url = extractLinkFromItem(b);
    if (!title || !url) continue;

    const publishedAt = extractPublishedAt(b);
    const imageUrl = extractImageUrl(b);

    out.push({
      title,
      url,
      imageUrl: imageUrl ? safeUrl(imageUrl) : null,
      publishedAt: publishedAt ? publishedAt.toISOString() : null,
      _rawDate: publishedAt ? publishedAt.getTime() : 0,
      _isAtom: isAtom,
    });
  }
  return out;
}

async function readSources() {
  for (const p of SOURCES_CANDIDATES) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const json = JSON.parse(raw);
      if (Array.isArray(json?.sources) && json.sources.length) return json.sources;
    } catch {
      // tenta o próximo caminho
    }
  }
  throw new Error(
    `Não encontrei news_sources.json. Tente criar ${SOURCES_CANDIDATES[0]} ou ${SOURCES_CANDIDATES[1]}`
  );
}

function withinMaxAge(isoOrNull) {
  if (!isoOrNull) return false; // sem data -> descarta p/ evitar notícias antigas
  const t = new Date(isoOrNull).getTime();
  if (Number.isNaN(t)) return false;
  return t >= (nowMs() - daysToMs(MAX_AGE_DAYS));
}

// ----------------------------- main -----------------------------

async function main() {
  const sources = await readSources();

  const stats = {
    sourcesTotal: sources.length,
    fetched: 0,
    itemsRaw: 0,
    itemsAfterFilter: 0,
    itemsWritten: 0,
    errors: [],
  };

  const all = [];
  for (const src of sources) {
    const rss = src.rss || src.url || src.feed;
    if (!rss) continue;

    try {
      const xml = await fetchText(rss);
      stats.fetched += 1;

      const parsed = parseFeed(xml);
      stats.itemsRaw += parsed.length;

      // aplica filtros + anexa metadados da fonte
      const filtered = parsed
        .filter(it => withinMaxAge(it.publishedAt))
        .slice(0, MAX_PER_SOURCE)
        .map(it => ({
          title: it.title,
          url: it.url,
          imageUrl: it.imageUrl,
          source: src.name || "Fonte oficial",
          publishedAt: it.publishedAt,
          scope: src.scope || "local",
          city: src.city || null,
          state: src.state || null,
        }));

      stats.itemsAfterFilter += filtered.length;
      all.push(...filtered);
    } catch (e) {
      stats.errors.push({ source: src.name || rss, error: String(e?.message || e) });
    }
  }

  // Dedup por URL
  const seen = new Set();
  const dedup = [];
  for (const it of all) {
    const key = it.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(it);
  }

  // Ordena por data (desc)
  dedup.sort((a, b) =>
    (new Date(b.publishedAt).getTime() || 0) - (new Date(a.publishedAt).getTime() || 0)
  );

  // Limita total
  const items = dedup.slice(0, MAX_ITEMS_TOTAL);

  const payload = {
    generatedAt: new Date().toISOString(),
    items,
    stats: {
      ...stats,
      itemsWritten: items.length,
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf-8");

  console.log(`OK: ${OUT_FILE} (${items.length} itens)`);
  if (stats.errors.length) {
    console.log("Avisos:", stats.errors);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
