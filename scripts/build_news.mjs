import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "news.json");

/** ✅ TROQUE AQUI */
const CITY = "Colatina ES";

/** ✅ Queries mais abertas (pra não ficar vazio) */
const QUERIES = [
  `${CITY}`,
  `${CITY} (obra OR trânsito OR vacinação OR mutirão OR evento OR serviço OR atendimento)`,
  `${CITY} prefeitura`,
  `${CITY} saúde`,
];

const MAX_ITEMS = 40;

/** ✅ Filtro soft (mais leve pra não zerar) */
const BLOCK = [
  "assassin", "homic", "tirote", "estupro"
  // ⚠️ Repare: tirei “morte/polícia/crime” porque às vezes zera tudo.
];

const SOURCE_MAP = {
  "g1.globo.com": "G1",
  "agazeta.com.br": "A Gazeta",
  "folhavitoria.com.br": "Folha Vitória",
  "uol.com.br": "UOL",
  "terra.com.br": "Terra",
  "metropoles.com": "Metrópoles",
  "cnnbrasil.com.br": "CNN Brasil",
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

async function resolveFinalUrl(url, timeoutMs = 15000) {
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

function guessSourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return SOURCE_MAP[host] || host;
  } catch {
    return "Fonte";
  }
}

function absolutizeImage(img, baseUrl) {
  if (!img) return "";
  const u = strip(img);
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

/**
 * Enriquecimento “melhor esforço”.
 * Se falhar, a notícia ainda vai entrar SEM imagem.
 */
async function enrich(newsLink) {
  const finalUrl = await resolveFinalUrl(newsLink);

  // Se ficou no Google, ainda assim aceitamos (mas sem imagem/fonte bonita)
  let html = "";
  try {
    // só tenta baixar HTML do site real se não for Google
    if (!finalUrl.includes("google.com")) {
      html = await fetchText(finalUrl, 15000);
    }
  } catch {
    html = "";
  }

  let title = "";
  let source = "";
  let imageUrl = "";

  if (html) {
    const ogTitle = strip(pickMeta(html, "og:title"));
    const titleTag = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
    title = ogTitle || titleTag;

    const ogSite = strip(pickMeta(html, "og:site_name"));
    source = ogSite || guessSourceFromUrl(finalUrl);

    const ogImg = strip(pickMeta(html, "og:image"));
    const twImg = strip(pickMeta(html, "twitter:image")) || strip(pickMeta(html, "twitter:image:src"));
    imageUrl = absolutizeImage(ogImg || twImg, finalUrl);

    if (imageUrl.includes("news.google") || imageUrl.includes("gstatic")) imageUrl = "";
  } else {
    source = guessSourceFromUrl(finalUrl);
  }

  return { title, source, imageUrl, finalUrl };
}

async function main() {
  const rssItems = [];
  const rssFailures = [];

  for (const q of QUERIES) {
    const rssUrl = googleNewsRssUrl(q);
    try {
      const xml = await fetchText(rssUrl, 20000);
      rssItems.push(...parseRssItems(xml));
    } catch (e) {
      rssFailures.push({ rssUrl, error: String(e?.message || e) });
    }
  }

  const uniq = new Map();
  for (const it of rssItems) {
    if (!uniq.has(it.link)) uniq.set(it.link, it);
  }

  const out = [];
  let blocked = 0;
  let enrichFailed = 0;

  for (const it of uniq.values()) {
    if (out.length >= MAX_ITEMS) break;

    if (softBlock(it.title)) {
      blocked++;
      continue;
    }

    try {
      const e = await enrich(it.link);

      // ✅ fallback: se não pegou title do site real, usa title do RSS
      const finalTitle = strip(e.title || it.title);
      if (!finalTitle) continue;

      out.push({
        id: `n:${Math.abs(hashCode(e.finalUrl || it.link))}`,
        title: finalTitle,
        source: strip(e.source) || "Google Notícias",
        publishedAt: it.pubDate || "",
        url: e.finalUrl || it.link,
        imageUrl: e.imageUrl || ""
      });
    } catch (e) {
      enrichFailed++;
      // ✅ fallback total: ainda coloca pelo RSS (sem imagem)
      out.push({
        id: `n:${Math.abs(hashCode(it.link))}`,
        title: it.title,
        source: "Google Notícias",
        publishedAt: it.pubDate || "",
        url: it.link,
        imageUrl: ""
      });
    }
  }

  // ✅ Se mesmo assim não vier nada, cria 1 item “comunicado” pra não ficar vazio
  if (out.length === 0) {
    out.push({
      id: "pv:fallback",
      title: "Sem notícias no momento",
      source: "PontoView",
      publishedAt: new Date().toISOString(),
      url: "",
      imageUrl: ""
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    items: out,
    stats: {
      discovered: uniq.size,
      produced: out.length,
      blocked_titles: blocked,
      enrich_failed: enrichFailed,
      rss_failures: rssFailures.length
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
