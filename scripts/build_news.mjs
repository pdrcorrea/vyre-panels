import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "news.json");

// Ajuste aqui: sua cidade/tema (quanto melhor, mais resultados “soft”)
const QUERIES = [
  // Troque "Colatina ES" pela sua cidade
  `Colatina ES (obra OR trânsito OR vacinação OR mutirão OR evento OR serviço)`,
  `Colatina ES utilidade pública`,
];

// Monta URL de RSS do Google News
function googleNewsRssUrl(q) {
  const qp = encodeURIComponent(q);
  return `https://news.google.com/rss/search?q=${qp}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions) PontoView/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

// RSS simples: pega <item><title>,<link>,<pubDate>
function parseRssItems(xml) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const chunk of itemMatches) {
    const title = (chunk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
                   chunk.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const link = (chunk.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const pubDate = (chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
    if (title && link) items.push({ title, link, pubDate });
  }
  return items;
}

function pickMeta(html, propertyOrName) {
  // og:* normalmente vem como property="og:image"
  const re1 = new RegExp(`<meta[^>]+property=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+name=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(re1)?.[1] || html.match(re2)?.[1] || "";
}

function strip(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function softBlock(title) {
  const t = title.toLowerCase();
  const bad = ["morte","assassin","crime","violên","tirote","trag","polícia","eleição","corrup"];
  return bad.some(w => t.includes(w));
}

async function enrichWithOg(link) {
  // 1) Abre o link do Google News (isso redireciona)
  const res = await fetch(link, {
    headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions) PontoView/1.0" },
    redirect: "follow"
  });

  // 2) URL final = site real da notícia
  const finalUrl = res.url;

  // 3) Agora sim buscamos o HTML do site real
  const html = await fetchText(finalUrl);

  const ogTitle = pickMeta(html, "og:title");
  const ogImage = pickMeta(html, "og:image");
  const siteName = pickMeta(html, "og:site_name");

  const titleTag =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";

  const finalTitle = strip(ogTitle || titleTag);

  let imageUrl = strip(ogImage);

  // Corrige imagem relativa
  try {
    if (imageUrl && imageUrl.startsWith("/")) {
      const u = new URL(finalUrl);
      imageUrl = `${u.origin}${imageUrl}`;
    }
  } catch {}

  return {
    finalTitle,
    imageUrl,
    siteName: strip(siteName),
    finalUrl
  };
}


async function main() {
  const rawItems = [];
  for (const q of QUERIES) {
    const rssUrl = googleNewsRssUrl(q);
    try {
      const xml = await fetchText(rssUrl);
      rawItems.push(...parseRssItems(xml));
    } catch (e) {
      // não mata tudo
      console.error("[warn] rss fail:", rssUrl, e.message);
    }
  }

  // Remove duplicados por link
  const uniq = new Map();
  for (const it of rawItems) {
    if (!uniq.has(it.link)) uniq.set(it.link, it);
  }

  const items = [];
  for (const it of uniq.values()) {
    if (softBlock(it.title)) continue;

    let enriched = { finalTitle: it.title, imageUrl: "", siteName: "" };
    try {
      enriched = await enrichWithOg(it.link);
    } catch (e) {
      // ok, fica sem imagem
      console.error("[warn] enrich fail:", it.link, e.message);
    }

    const title = strip(enriched.finalTitle || it.title);
    if (!title) continue;

    items.push({
  id: `n:${Math.abs(hashCode(final.link || it.link))}`,
  title,
  source: enriched.siteName || "Fonte local",
  publishedAt: it.pubDate || "",
  url: enriched.finalUrl || it.link,
  imageUrl: enriched.imageUrl || ""
});
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    items: items.slice(0, 40) // leve para TV
  };

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote data/news.json with ${payload.items.length} items`);
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
