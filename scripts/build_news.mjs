// scripts/build_news.mjs
// Gera ./data/news.json com notícias (Local/Estadual/Nacional) intercaladas
// Fonte: sites oficiais (prefeituras + governo) + Agência Brasil + Ministério da Saúde
// Filtro: no máximo 3 dias

import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "news.json");

const MAX_AGE_DAYS = 3;
const MAX_ITEMS_TOTAL = 36;      // total no JSON
const MAX_PER_SOURCE = 10;       // coleta bruta por fonte (antes de filtrar)
const FETCH_TIMEOUT_MS = 20000;

const SOURCES = {
  local: [
    { name: "Prefeitura de Vitória", city: "Vitória", url: "https://www.vitoria.es.gov.br/imprensa/todas_noticias" },
    { name: "Prefeitura de Linhares", city: "Linhares", url: "https://linhares.es.gov.br/category/noticias/" },
    { name: "Prefeitura de Colatina", city: "Colatina", url: "https://colatina.es.gov.br/agencia-de-noticias/" },
    { name: "Prefeitura de Cachoeiro", city: "Cachoeiro de Itapemirim", url: "https://www.cachoeiro.es.gov.br/noticias/" },
  ],
  state: [
    { name: "Governo do ES (ES.GOV)", url: "https://www.es.gov.br/Noticias" },
    { name: "Portal ES.GOV (catálogo)", url: "https://portal.es.gov.br/app/catalog/noticias" },
  ],
  national: [
    { name: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br/ultimas" },
    { name: "Ministério da Saúde", url: "https://www.gov.br/saude/pt-br/assuntos/noticias" },
  ],
};

function now() {
  return new Date();
}
function daysAgo(d) {
  return new Date(now().getTime() - d * 24 * 60 * 60 * 1000);
}
function clampStr(s) {
  return (s ?? "").toString().replace(/\s+/g, " ").trim();
}
function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
function uniq(arr) {
  return [...new Set(arr)];
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "PontoView-VyreBot/1.0 (+github-actions)",
        "accept": "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function pickMeta(html, namesOrProps) {
  // procura meta name=... ou property=...
  for (const key of namesOrProps) {
    // content="..."
    const r1 = new RegExp(`<meta[^>]+(?:name|property)=["']${escapeReg(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const m1 = html.match(r1);
    if (m1?.[1]) return clampStr(decodeHtml(m1[1]));
    // content='...'
    const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapeReg(key)}["'][^>]*>`, "i");
    const m2 = html.match(r2);
    if (m2?.[1]) return clampStr(decodeHtml(m2[1]));
  }
  return "";
}

function decodeHtml(s) {
  // decodificação mínima (o suficiente para títulos)
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAnyDate(html) {
  // 1) metas comuns
  const iso =
    pickMeta(html, ["article:published_time", "og:updated_time", "date", "dc.date", "DC.date.issued", "pubdate", "publish-date", "parsely-pub-date"]) ||
    "";

  const iso2 = iso ? Date.parse(iso) : NaN;
  if (!Number.isNaN(iso2)) return new Date(iso2);

  // 2) padrões pt-BR: "Publicado em 30/12/2025" / "30/12/2025"
  const m1 = html.match(/Publicado\s+em\s+(\d{2}\/\d{2}\/\d{4})/i);
  const m2 = html.match(/(\d{2}\/\d{2}\/\d{4})/);
  const dmy = (m1?.[1] || m2?.[1] || "").trim();
  if (dmy) {
    const [dd, mm, yyyy] = dmy.split("/").map(Number);
    if (dd && mm && yyyy) return new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  }

  // 3) Agência Brasil usa "ter, 30/12/2025 - 07:36" na listagem e no artigo
  const m3 = html.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})/);
  if (m3) {
    const [dd, mm, yyyy] = m3[1].split("/").map(Number);
    const [hh, min] = m3[2].split(":").map(Number);
    return new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, 0));
  }

  return null;
}

function extractLinks(html, baseUrl) {
  // captura href="..."
  const hrefs = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(baseUrl, m[1]);
    if (u) hrefs.push(u);
  }
  return uniq(hrefs);
}

function domainOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function looksLikeArticle(url) {
  // heurística simples: evita PDFs, anchors, etc.
  if (!url || url.includes("#")) return false;
  if (/\.(pdf|jpg|jpeg|png|webp|svg)(\?|$)/i.test(url)) return false;
  return true;
}

function filterToSameDomain(listUrl, links) {
  const d = domainOf(listUrl);
  return links.filter((u) => domainOf(u) === d);
}

function scoreCandidate(url) {
  // preferir URLs que "parecem" notícia
  let s = 0;
  if (/noticia|noticias|imprensa|agencia|conteudo|\/Noticia\/|\/Noticia\//i.test(url)) s += 2;
  if (/\d{4}/.test(url)) s += 1;
  if (url.length > 40) s += 1;
  return s;
}

function pickTopCandidates(listUrl, html) {
  const all = extractLinks(html, listUrl)
    .filter(looksLikeArticle);

  const same = filterToSameDomain(listUrl, all);
  const ranked = same
    .map((u) => ({ u, s: scoreCandidate(u) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.u);

  // remove listUrl itself e páginas de navegação comuns
  const cleaned = ranked.filter((u) => u !== listUrl && !/page\/\d+\/?$|\/pagina\/\d+\/?$/i.test(u));
  return cleaned.slice(0, MAX_PER_SOURCE);
}

function withinMaxAge(dateObj) {
  if (!dateObj) return false;
  return dateObj >= daysAgo(MAX_AGE_DAYS);
}

async function parseArticle(url, scope, meta = {}) {
  const html = await fetchText(url);

  const title =
    pickMeta(html, ["og:title", "twitter:title"]) ||
    clampStr((html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ""));

  const image =
    pickMeta(html, ["og:image", "twitter:image", "twitter:image:src"]) ||
    "";

  const site =
    pickMeta(html, ["og:site_name"]) ||
    meta.sourceName ||
    domainOf(url);

  const published = parseAnyDate(html);

  // filtro de até 3 dias
  if (!withinMaxAge(published)) return null;

  // título mínimo
  if (!title || title.length < 12) return null;

  // evita manchetes muito vagas (opcional: pode ajustar)
  const bad = /(veja|entenda|saiba|confira)\s+o?\s*(que|como)/i;
  if (bad.test(title) && scope !== "local") {
    // mantém mais rigor em estadual/nacional
    return null;
  }

  return {
    title,
    url,
    image: image || null,
    source: site,
    publishedAt: published.toISOString(),
    scope,                    // local | state | national
    city: meta.city || null,  // só local
  };
}

async function collectFromSource(src, scope) {
  const listHtml = await fetchText(src.url);
  const candidates = pickTopCandidates(src.url, listHtml);

  const items = [];
  for (const u of candidates) {
    try {
      const it = await parseArticle(u, scope, { sourceName: src.name, city: src.city });
      if (it) items.push(it);
    } catch {
      // ignora item quebrado
    }
  }
  return items;
}

function interleaveBuckets(buckets, pattern, maxTotal) {
  // pattern exemplo: ["local","local","state","local","national","state"]
  const out = [];
  const seen = new Set();

  // normaliza por data (mais novo primeiro) dentro de cada bucket
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }

  let idx = 0;
  while (out.length < maxTotal) {
    const key = pattern[idx % pattern.length];
    idx++;

    const arr = buckets[key] || [];
    while (arr.length) {
      const it = arr.shift();
      const sig = it.url;
      if (!seen.has(sig)) {
        seen.add(sig);
        out.push(it);
        break;
      }
    }

    // se todos esvaziaram, para
    const remaining = Object.values(buckets).reduce((n, a) => n + a.length, 0);
    if (remaining === 0) break;
  }

  return out;
}

async function main() {
  const buckets = { local: [], state: [], national: [] };

  // Coleta em paralelo por categoria (com moderação)
  const tasks = [];

  for (const src of SOURCES.local) tasks.push(collectFromSource(src, "local").then((r) => buckets.local.push(...r)));
  for (const src of SOURCES.state) tasks.push(collectFromSource(src, "state").then((r) => buckets.state.push(...r)));
  for (const src of SOURCES.national) tasks.push(collectFromSource(src, "national").then((r) => buckets.national.push(...r)));

  await Promise.allSettled(tasks);

  // Intercala: Local forte, ES médio, Brasil leve
  const pattern = ["local", "local", "state", "local", "national", "state"];
  const items = interleaveBuckets(buckets, pattern, MAX_ITEMS_TOTAL);

  const payload = {
    generatedAt: new Date().toISOString(),
    items,
    stats: {
      local: buckets.local.length,
      state: buckets.state.length,
      national: buckets.national.length,
      final: items.length,
      maxAgeDays: MAX_AGE_DAYS,
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf-8");

  console.log(`OK: ${OUT_FILE} (${items.length} itens)`);
  console.log(payload.stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
