// ===== scripts/build_news.mjs (SUBSTITUA INTEIRO) =====
// Mantém seu painel atual (vyre-light.css) e agora cada item traz:
// - sourceDomain (ex: agenciabrasil.ebc.com.br)
// - sourceLogoUrl (favicon automático do domínio)
// Também força a "Fonte" a ser o domínio/veículo (evita aparecer "Google Fonts" etc.)
// Filtro: no máximo 3 dias | Intercalado: Local -> Local -> ES -> Local -> Brasil -> ES

import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "news.json");

const MAX_AGE_DAYS = 3;
const MAX_ITEMS_TOTAL = 36;
const MAX_PER_SOURCE = 12;
const FETCH_TIMEOUT_MS = 20000;

const SOURCES = {
  local: [
    { name: "Prefeitura de Vitória", city: "Vitória", url: "https://www.vitoria.es.gov.br/imprensa/todas_noticias" },
    { name: "Prefeitura de Linhares", city: "Linhares", url: "https://linhares.es.gov.br/category/noticias/" },
    { name: "Prefeitura de Colatina", city: "Colatina", url: "https://colatina.es.gov.br/agencia-de-noticias/" },
    { name: "Prefeitura de Cachoeiro", city: "Cachoeiro de Itapemirim", url: "https://www.cachoeiro.es.gov.br/noticias/" },
  ],
  state: [
    { name: "Governo do ES", url: "https://www.es.gov.br/Noticias" },
    { name: "Portal ES.GOV", url: "https://portal.es.gov.br/app/catalog/noticias" },
  ],
  national: [
    { name: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br/ultimas" },
    { name: "Ministério da Saúde", url: "https://www.gov.br/saude/pt-br/assuntos/noticias" },
  ],
};

function now() { return new Date(); }
function daysAgo(n) { return new Date(now().getTime() - n * 24 * 60 * 60 * 1000); }
function clampStr(s) { return (s ?? "").toString().replace(/\s+/g, " ").trim(); }
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function absUrl(base, href) { try { return new URL(href, base).toString(); } catch { return null; } }
function uniq(arr) { return [...new Set(arr)]; }

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "PontoView-VyreBot/1.2 (+github-actions)", "accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function pickMeta(html, keys) {
  for (const key of keys) {
    const r1 = new RegExp(`<meta[^>]+(?:name|property)=["']${escapeReg(key)}["'][^>]+content=["']([^"']+)["']`, "i");
    const m1 = html.match(r1);
    if (m1?.[1]) return clampStr(decodeHtml(m1[1]));
    const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapeReg(key)}["']`, "i");
    const m2 = html.match(r2);
    if (m2?.[1]) return clampStr(decodeHtml(m2[1]));
  }
  return "";
}

function parseAnyDate(html) {
  const iso =
    pickMeta(html, ["article:published_time", "og:updated_time", "date", "dc.date", "DC.date.issued", "pubdate", "publish-date", "parsely-pub-date"]) || "";
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isNaN(ts)) return new Date(ts);

  const m1 = html.match(/Publicado\s+em\s+(\d{2}\/\d{2}\/\d{4})/i);
  const m2 = html.match(/(\d{2}\/\d{2}\/\d{4})/);
  const dmy = (m1?.[1] || m2?.[1] || "").trim();
  if (dmy) {
    const [dd, mm, yyyy] = dmy.split("/").map(Number);
    if (dd && mm && yyyy) return new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  }

  const m3 = html.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})/);
  if (m3) {
    const [dd, mm, yyyy] = m3[1].split("/").map(Number);
    const [hh, min] = m3[2].split(":").map(Number);
    return new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, 0));
  }

  return null;
}

function withinMaxAge(d) {
  if (!d) return false;
  return d >= daysAgo(MAX_AGE_DAYS);
}

function extractLinks(html, baseUrl) {
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
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}
function looksLikeArticle(url) {
  if (!url || url.includes("#")) return false;
  if (/\.(pdf|jpg|jpeg|png|webp|svg|css|js)(\?|$)/i.test(url)) return false;
  return true;
}
function scoreCandidate(url) {
  let s = 0;
  if (/noticia|noticias|imprensa|agencia|conteudo|\/Noticia\/|\/Noticias\/|\/noticia\//i.test(url)) s += 3;
  if (/\d{4}/.test(url)) s += 1;
  if (url.length > 40) s += 1;
  return s;
}
function pickTopCandidates(listUrl, html) {
  const all = extractLinks(html, listUrl).filter(looksLikeArticle);

  const d = domainOf(listUrl);
  const same = all.filter((u) => domainOf(u) === d);

  const ranked = same
    .map((u) => ({ u, s: scoreCandidate(u) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.u);

  const cleaned = ranked.filter((u) => u !== listUrl && !/page\/\d+\/?$|\/pagina\/\d+\/?$/i.test(u));
  return cleaned.slice(0, MAX_PER_SOURCE);
}

// favicon automático (sem armazenar imagens)
function faviconUrlForDomain(domain) {
  // serviço do Google (favicon) — ótimo para TV
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

// Nome “bonito” baseado no domínio (evita "Google Fonts")
function prettySourceFromDomain(domain) {
  if (!domain) return "Fonte";
  // você pode refinar aqui se quiser nomes específicos
  if (domain.includes("agenciabrasil.ebc.com.br")) return "Agência Brasil";
  if (domain.includes("gov.br")) return "Governo Federal";
  if (domain.endsWith(".es.gov.br")) return "Governo do ES";
  return domain;
}

async function parseArticle(url, scope, meta = {}) {
  const html = await fetchText(url);

  const title =
    pickMeta(html, ["og:title", "twitter:title"]) ||
    clampStr((html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ""));

  const image =
    pickMeta(html, ["og:image", "twitter:image", "twitter:image:src"]) || "";

  const published = parseAnyDate(html);
  if (!withinMaxAge(published)) return null;

  if (!title || title.length < 12) return null;

  // evita manchetes muito vagas fora do escopo local (ajustável)
  const vague = /(veja|entenda|saiba|confira)\s+/i;
  if (vague.test(title) && scope !== "local") return null;

  const sourceDomain = domainOf(url);
  const source = meta.sourceName || prettySourceFromDomain(sourceDomain);

  return {
    id: `n:${Math.abs(hashString(url))}`,
    title,
    url,
    imageUrl: image || "",
    publishedAt: published.toISOString(),
    scope, // local | state | national
    city: meta.city || "",
    source,                 // nome exibível
    sourceDomain,           // domínio para favicon
    sourceLogoUrl: sourceDomain ? faviconUrlForDomain(sourceDomain) : "",
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
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
      // ignora
    }
  }
  return items;
}

function interleaveBuckets(buckets, pattern, maxTotal) {
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }

  const out = [];
  const seen = new Set();
  let i = 0;

  while (out.length < maxTotal) {
    const key = pattern[i % pattern.length];
    i++;

    const arr = buckets[key] || [];
    while (arr.length) {
      const it = arr.shift();
      if (!seen.has(it.url)) {
        seen.add(it.url);
        out.push(it);
        break;
      }
    }

    const remaining = Object.values(buckets).reduce((n, a) => n + a.length, 0);
    if (remaining === 0) break;
  }
  return out;
}

async function main() {
  const buckets = { local: [], state: [], national: [] };

  const tasks = [];
  for (const src of SOURCES.local) tasks.push(collectFromSource(src, "local").then(r => buckets.local.push(...r)));
  for (const src of SOURCES.state) tasks.push(collectFromSource(src, "state").then(r => buckets.state.push(...r)));
  for (const src of SOURCES.national) tasks.push(collectFromSource(src, "national").then(r => buckets.national.push(...r)));

  await Promise.allSettled(tasks);

  const pattern = ["local", "local", "state", "local", "national", "state"];
  const items = interleaveBuckets(buckets, pattern, MAX_ITEMS_TOTAL);

  const payload = {
    generatedAt: new Date().toISOString(),
    items,
    stats: {
      maxAgeDays: MAX_AGE_DAYS,
      collected: { local: buckets.local.length, state: buckets.state.length, national: buckets.national.length },
      final: items.length
    }
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`OK: ${OUT_FILE} (${items.length} itens)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
