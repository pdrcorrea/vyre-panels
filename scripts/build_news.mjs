// ===== scripts/build_news.mjs (SUBSTITUA INTEIRO) =====
// Local + Estadual + Nacional (intercalado) + somente recentes (até 3 dias)
// Observação importante: sem “servidor”, a localização automática por dispositivo (IP/GPS)
// não dá para usar no GitHub Actions (ele roda fora do Brasil). Então aqui você define CITY/STATE.
// Se você tiver TVs em cidades diferentes, pode duplicar este repo por cidade ou usar branches.

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "news.json");

/** ✅ DEFINA AQUI (fixo para o seu painel) */
const CITY = "Colatina";
const STATE_NAME = "Espírito Santo";
const COUNTRY = "Brasil";

/** ✅ Somente até 3 dias atrás */
const MAX_AGE_DAYS = 3;

/** ✅ Quantidade total final */
const MAX_ITEMS = 40;

/** ✅ Filtro leve (evita temas pesados sem zerar tudo) */
const BLOCK = ["assassin", "homic", "tirote", "estupro"];

/** ✅ Nomes “bonitos” (domínio -> nome) */
const SOURCE_MAP = {
  "g1.globo.com": "G1",
  "agazeta.com.br": "A Gazeta",
  "folhavitoria.com.br": "Folha Vitória",
  "uol.com.br": "UOL",
  "terra.com.br": "Terra",
  "metropoles.com": "Metrópoles",
  "cnnbrasil.com.br": "CNN Brasil",
};

/**
 * ✅ GOOGLE NEWS: usamos "when:3d" para priorizar recentes
 * (além do filtro por pubDate em até 3 dias).
 */
const FEEDS = [
  {
    scope: "local",
    label: "Local",
    queries: [
      `${CITY} when:3d`,
      `${CITY} (${STATE_NAME}) (obra OR trânsito OR vacinação OR mutirão OR evento OR serviço OR atendimento) when:3d`,
      `${CITY} prefeitura when:3d`,
    ],
  },
  {
    scope: "state",
    label: "Estadual",
    queries: [
      `${STATE_NAME} when:3d`,
      `${STATE_NAME} (obra OR trânsito OR vacinação OR mutirão OR evento OR serviço OR saúde) when:3d`,
      `${STATE_NAME} governo when:3d`,
    ],
  },
  {
    scope: "national",
    label: "Nacional",
    queries: [
      `${COUNTRY} when:3d`,
      `${COUNTRY} (serviço OR saúde OR educação OR tecnologia OR economia) when:3d`,
      `${COUNTRY} utilidade pública when:3d`,
    ],
  },
];

function googleNewsRssUrl(q) {
  const qp = encodeURIComponent(q);
  return `https://news.google.com/rss/search?q=${qp}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

function strip(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function softBlock(title) {
  const t = String(title || "").toLowerCase();
  return BLOCK.some((w) => t.includes(w));
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}

function daysAgo(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 999;
    const diffMs = Date.now() - d.getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  } catch {
    return 999;
  }
}

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions) PontoView/1.0" },
      redirect: "follow",
      signal: ctrl.signal,
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
      signal: ctrl.signal,
    });
    return res.url || url;
  } finally {
    clearTimeout(t);
  }
}

function pickMeta(html, key) {
  const r1 = new RegExp(
    `<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const r2 = new RegExp(
    `<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
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

// RSS: title/link/pubDate + (media:content|media:thumbnail)
function parseRssItems(xml, scope) {
  const items = [];
  const chunks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const c of chunks) {
    const title =
      c.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
      c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
      "";
    const link = c.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "";
    const pubDate = c.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "";

    const mediaContentUrl = c.match(/<media:content[^>]+url=["']([^"']+)["']/i)?.[1] || "";
    const mediaThumbUrl = c.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)?.[1] || "";
    const rssImage = strip(mediaContentUrl || mediaThumbUrl);

    const t = strip(title);
    const l = strip(link);
    const p = strip(pubDate);

    if (t && l) items.push({ title: t, link: l, pubDate: p, rssImage, scope });
  }
  return items;
}

/**
 * Enriquecimento melhor-esforço:
 * - tenta sair do Google e pegar og:image/tw:image + site_name
 * - se falhar, usa imagem do RSS (quando existir)
 */
async function enrich(newsLink, rssImage) {
  const finalUrl = await resolveFinalUrl(newsLink);

  let html = "";
  try {
    if (!finalUrl.includes("google.com")) html = await fetchText(finalUrl, 15000);
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
    const twImg =
      strip(pickMeta(html, "twitter:image")) || strip(pickMeta(html, "twitter:image:src"));
    imageUrl = absolutizeImage(ogImg || twImg, finalUrl);
  } else {
    source = guessSourceFromUrl(finalUrl);
  }

  if (!imageUrl && rssImage) imageUrl = rssImage;
  if (imageUrl.includes("news.google") || imageUrl.includes("gstatic")) imageUrl = "";

  // Se ainda estiver no Google, pelo menos use fonte pelo domínio do link original
  const finalSource = strip(source) || guessSourceFromUrl(finalUrl);

  return { title, source: finalSource, imageUrl, finalUrl };
}

// Intercala: local -> state -> national (quando houver)
function interleaveBuckets(buckets, maxOut) {
  const order = ["local", "state", "national"];
  const out = [];
  let i = 0;

  while (out.length < maxOut) {
    const key = order[i % order.length];
    const b = buckets[key];
    if (b && b.length) out.push(b.shift());
    i++;

    // para quando todos vazios
    if (order.every((k) => !buckets[k] || buckets[k].length === 0)) break;
  }
  return out;
}

async function main() {
  const all = [];
  const stats = {
    discovered: 0,
    produced: 0,
    blocked_titles: 0,
    dropped_old: 0,
    enrich_failed: 0,
  };

  // 1) coleta por escopo (local/estadual/nacional)
  for (const feed of FEEDS) {
    for (const q of feed.queries) {
      const rssUrl = googleNewsRssUrl(q);
      try {
        const xml = await fetchText(rssUrl, 20000);
        all.push(...parseRssItems(xml, feed.scope));
      } catch {
        // ignora falhas de um feed específico
      }
    }
  }

  // 2) dedup por link
  const uniq = new Map();
  for (const it of all) {
    const key = it.link;
    if (!uniq.has(key)) uniq.set(key, it);
  }
  stats.discovered = uniq.size;

  // 3) filtra: título pesado + máximo 3 dias
  const filtered = [];
  for (const it of uniq.values()) {
    if (softBlock(it.title)) {
      stats.blocked_titles++;
      continue;
    }
    // pubDate ausente: mantém (para não zerar), mas preferimos recentes
    if (it.pubDate) {
      if (daysAgo(it.pubDate) > MAX_AGE_DAYS) {
        stats.dropped_old++;
        continue;
      }
    }
    filtered.push(it);
  }

  // 4) separa em baldes e ordena por mais recente primeiro
  const buckets = { local: [], state: [], national: [] };
  for (const it of filtered) buckets[it.scope]?.push(it);

  const sortByDateDesc = (a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  };
  buckets.local.sort(sortByDateDesc);
  buckets.state.sort(sortByDateDesc);
  buckets.national.sort(sortByDateDesc);

  // 5) intercala local/estadual/nacional
  const selected = interleaveBuckets(buckets, MAX_ITEMS);

  // 6) enriquece e monta saída
  const out = [];
  for (const it of selected) {
    try {
      const e = await enrich(it.link, it.rssImage);
      const finalTitle = strip(e.title || it.title);
      if (!finalTitle) continue;

      out.push({
        id: `n:${Math.abs(hashCode(e.finalUrl || it.link))}`,
        title: finalTitle,
        source: strip(e.source) || "Fonte",
        publishedAt: it.pubDate || "",
        url: e.finalUrl || it.link,
        imageUrl: e.imageUrl || "",
        scope: it.scope, // local | state | national
      });
    } catch {
      stats.enrich_failed++;
      out.push({
        id: `n:${Math.abs(hashCode(it.link))}`,
        title: it.title,
        source: guessSourceFromUrl(it.link),
        publishedAt: it.pubDate || "",
        url: it.link,
        imageUrl: it.rssImage || "",
        scope: it.scope,
      });
    }
  }

  if (out.length === 0) {
    out.push({
      id: "pv:fallback",
      title: "Sem notícias recentes no momento",
      source: "PontoView",
      publishedAt: new Date().toISOString(),
      url: "",
      imageUrl: "",
      scope: "local",
    });
  }

  stats.produced = out.length;

  const payload = {
    generatedAt: new Date().toISOString(),
    config: { CITY, STATE_NAME, COUNTRY, MAX_AGE_DAYS },
    items: out,
    stats,
  };

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote data/news.json with ${payload.items.length} items`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
