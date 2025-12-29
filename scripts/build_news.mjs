import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "news.json");

/** ✅ TROQUE AQUI (cidade/estado) */
const CITY = "Colatina ES";

/** ✅ Queries “soft” (pode editar depois) */
const QUERIES = [
  `${CITY} (obra OR trânsito OR vacinação OR mutirão OR evento OR serviço OR atendimento)`,
  `${CITY} utilidade pública`,
  `${CITY} prefeitura`,
  `${CITY} evento`,
];

const MAX_ITEMS = 40;

// bloqueio leve por título (pra não entrar tragédia/polícia/política pesada)
const BLOCK = [
  "morte","assassin","crime","violên","tirote","trag","polícia","homic",
  "eleição","partido","corrup","escând"
];

// nomes “bonitos” (domínio -> nome)
const SOURCE_MAP = {
  "g1.globo.com": "G1",
  "oglobo.globo.com": "O Globo",
  "folha.uol.com.br": "Folha",
  "uol.com.br": "UOL",
  "agazeta.com.br": "A Gazeta",
  "folhavitoria.com.br": "Folha Vitória",
  "gazetaonline.com.br": "Gazeta Online",
  "terra.com.br": "Terra",
  "metropoles.com": "Metrópoles",
  "cnnbrasil.com.br": "CNN Brasil",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC"
};

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

async function resolveFinalUrl(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions) PontoView/1.0" },
      redirect: "follow",
      signal: ctrl.signal
    });
    return res.url || url;
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
  const r1 = new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i");
  const r2 = new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(r1)?.[1] || html.match(r2)?.[1] || "";
}

function guessSourceFromUrl(finalUrl) {
  try {
    const host = new URL(finalUrl).hostname.replace(/^www\./, "");
    return SOURCE_MAP[host] || host;
  } catch {
    return "Fonte";
  }
}

function absolutizeImage(url, baseUrl) {
  if (!url) return "";
  const u = strip(url);
  try {
    if (u.startsWith("//")) {
      const b = new URL(baseUrl);
      return `${b.protocol}${u}`;
    }
    if (u.startsWith("/")) {
      const b = new URL(baseUrl);
      return `${b.origin}${u}`;
    }
  } catch {}
  return u;
}

async function enrich(newsLink) {
  // 1) sai do Google News e chega no site real
  const finalUrl = await resolveFinalUrl(newsLink);

  // se ainda ficou no Google, ignora esse item
  if (finalUrl.includes("news.google.com") || finalUrl.includes("google.com")) {
    throw new Error("Final URL still Google");
  }

  // 2) baixa HTML do site real
  const html = await fetchText(finalUrl);

  // título
  const ogTitle = strip(pickMeta(html, "og:title"));
  const titleTag = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const title = ogTitle || titleTag;

  // fonte (nome bonito ou domínio)
  const ogSite = strip(pickMeta(html, "og:site_name"));
  const source = ogSite || guessSourceFromUrl(finalUrl);

  // imagem (og + twitter)
  const ogImg = strip(pickMeta(html, "og:image"));
  const twImg = strip(pickMeta(html, "twitter:image")) || strip(pickMeta(html, "twitter:image:src"));
  let imageUrl = absolutizeImage(ogImg || twImg, finalUrl);

  // evita imagens genéricas do Google/gstatic
  if (imageUrl.includes("news.google") || imageUrl.includes("gstatic")) imageUrl = "";

  return { title, source, imageUrl, finalUrl };
}

async function main() {
  const rssItems = [];

  // 1) descobre notícias via Google News RSS
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
  let failed = 0;
  let blocked = 0;

  // 3) enriquece (imagem+fonte+url real) — sem quebrar se 1 site falhar
  for (const it of uniq.values()) {
    if (out.length >= MAX_ITEMS) break;

    if (softBlock(it.title)) {
      blocked++;
      continue;
    }

    try {
      const e = await enrich(it.link);
      const title = strip(e.title || it.title);
      if (!title) continue;

      out.push({
        id: `n:${Math.abs(hashCode(e.finalUrl || it.link))}`,
        title,
        source: e.source || "Fonte",
        publishedAt: it.pubDate || "",
        url: e.finalUrl || it.link,
        imageUrl: e.imageUrl || ""
      });
    } catch (e) {
      failed++;
      // continua sem derrubar o build
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    items: out,
    stats: {
      discovered: uniq.size,
      produced: out.length,
      blocked_titles: blocked,
      failed_enrich: failed
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
