import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "news.json");

// ✅ Troque pela sua cidade/estado
const CITY = "Colatina ES";

// ✅ Queries “soft”
const QUERIES = [
  `${CITY} (obra OR trânsito OR vacinação OR mutirão OR evento OR serviço)`,
  `${CITY} utilidade pública`,
  `${CITY} prefeitura`,
];

const MAX_ITEMS = 40;

// bloqueio leve (título)
const BLOCK = ["morte","assassin","crime","violên","tirote","trag","polícia","eleição","corrup","homic"];

function googleNewsRssUrl(q) {
  const qp = encodeURIComponent(q);
  return `https://news.google.com/rss/search?q=${qp}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

function strip(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function softBlock(title) {
  const t = String(title || "").toLowerCase();
  return BLOCK.some(w => t.includes(w));
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions) PontoView/1.0" },
      redirect: "follow",
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// RSS simples: <item><title> <link> <pubDate>
function parseRssItems(xml) {
  const items = [];
  const chunks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const c of chunks) {
    const title =
      (c.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
       c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const link = (c.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    const pubDate = (c.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "");
    const t = strip(title);
    const l = strip(link);
    if (t && l) items.push({ title: t, link: l, pubDate: strip(pubDate) });
  }
  return items;
}

function pickMeta(html, key) {
  // property="og:image" OR name="twitter:image"
  const r1 = new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i");
  const r2 = new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(r1)?.[1] || html.match(r2)?.[1] || "";
}

async function resolveFinalUrl(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions) PontoView/1.0" },
      redirect: "follow",
      signal: ctrl.signal
    });
    // ✅ res.url = URL final depois dos redirects
    return res.url || url;
  } finally {
    clearTimeout(t);
  }
}

async function enrich(link) {
  // 1) chega no site real (não na página intermediária do Google News)
  const finalUrl = await resolveFinalUrl(link);

  // 2) baixa HTML do site real
  const html = await fetchText(finalUrl);

  const ogTitle = strip(pickMeta(html, "og:title"));
  const ogImage = strip(pickMeta(html, "og:image"));
  const siteName = strip(pickMeta(html, "og:site_name")) || strip(pickMeta(html, "application-name"));

  const titleTag = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const title = ogTitle || titleTag;

  // corrige imagem relativa
  let imageUrl = ogImage;
  try {
    if (imageUrl && imageUrl.startsWith("/")) {
      const u = new URL(finalUrl);
      imageUrl = `${u.origin}${imageUrl}`;
    }
  } catch {}

  // evita logo do Google/gstatic como “imagem da notícia”
  if (imageUrl.includes("news.google") || imageUrl.includes("gstatic")) imageUrl = "";

  return { title, imageUrl, siteName, finalUrl };
}

async function main() {
  const rssItems = [];

  // 1) coleta itens do RSS do Google News (descoberta)
  for (const q of QUERIES) {
    const rssUrl = googleNewsRssUrl(q);
    try {
      const xml = await fetchText(rssUrl, 20000);
      rssItems.push(...parseRssItems(xml));
    } catch (e) {
      console.error("[warn] RSS failed:", rssUrl, e?.message || e);
    }
  }

  // 2) dedup por link
  const uniq = new Map();
  for (const it of rssItems) {
    if (!uniq.has(it.link)) uniq.set(it.link, it);
  }

  const out = [];
  const failures = [];

  // 3) enriquece (imagem + fonte) SEM quebrar se falhar
  for (const it of uniq.values()) {
    if (out.length >= MAX_ITEMS) break;
    if (softBlock(it.title)) continue;

    try {
      const e = await enrich(it.link);
      const title = strip(e.title || it.title);
      if (!title) continue;

      out.push({
        id: `n:${Math.abs(hashCode(e.finalUrl || it.link))}`,
        title,
        source: e.siteName || "Google Notícias",
        publishedAt: it.pubDate || "",
        url: e.finalUrl || it.link,
        imageUrl: e.imageUrl || ""
      });
    } catch (e) {
      failures.push({ link: it.link, error: String(e?.message || e) });
      // continua
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    items: out,
    stats: {
      discovered: uniq.size,
      produced: out.length,
      failed_enrich: failures.length
      // se quiser depurar mais: failures
    }
  };

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote data/news.json with ${payload.items.length} items`);
  console.log("Stats:", payload.stats);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
