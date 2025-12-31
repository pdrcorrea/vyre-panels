// build_news.mjs — PLUG & PLAY
// Gera ./data/news.json com notícias por ESCOPO (local/state/national/health) e já alternadas.
// - Fontes: oficiais (prefeituras, governo, órgãos federais) + Agência Brasil
// - Captura imagem via OG/Twitter meta (melhor compatibilidade com o painel)
// - Filtra por idade (MAX_AGE_DAYS) e limita volume (MAX_ITEMS_TOTAL)
//
// Como usar (GitHub Actions / Node):
//   node build_news.mjs
// Opcional:
//   NEWS_SOURCES_FILE=news_sources_local.json node build_news.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "news.json");

const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 3);
const MAX_ITEMS_TOTAL = Number(process.env.MAX_ITEMS_TOTAL || 36);
const MAX_PER_SOURCE = Number(process.env.MAX_PER_SOURCE || 12);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const SOURCES_FILE = process.env.NEWS_SOURCES_FILE || "news_sources_local.json";

const DEFAULT_SOURCES = {
  local: [
    { name: "Prefeitura de Vitória", city: "Vitória", url: "https://www.vitoria.es.gov.br/imprensa/todas_noticias" },
    { name: "Prefeitura de Linhares", city: "Linhares", url: "https://linhares.es.gov.br/category/noticias/" },
    { name: "Prefeitura de Colatina", city: "Colatina", url: "https://colatina.es.gov.br/agencia-de-noticias/" },
    { name: "Prefeitura de Cachoeiro", city: "Cachoeiro de Itapemirim", url: "https://www.cachoeiro.es.gov.br/noticias/" },
  ],
  state: [
    { name: "Governo do ES (ES.GOV)", url: "https://www.es.gov.br/Noticias" },
    { name: "Portal ES.GOV (Catálogo)", url: "https://portal.es.gov.br/app/catalog/noticias" },
  ],
  national: [
    { name: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br/ultimas" },
    { name: "Governo Federal (gov.br Notícias)", url: "https://www.gov.br/pt-br/noticias" },
  ],
  health: [
    { name: "Ministério da Saúde", url: "https://www.gov.br/saude/pt-br/assuntos/noticias" },
    { name: "Fiocruz", url: "https://portal.fiocruz.br/noticias" },
  ],
};

async function readSources() {
  try {
    const raw = await fs.readFile(SOURCES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      local: Array.isArray(parsed.local) ? parsed.local : DEFAULT_SOURCES.local,
      state: Array.isArray(parsed.state) ? parsed.state : DEFAULT_SOURCES.state,
      national: Array.isArray(parsed.national) ? parsed.national : DEFAULT_SOURCES.national,
      health: Array.isArray(parsed.health) ? parsed.health : DEFAULT_SOURCES.health,
    };
  } catch {
    return DEFAULT_SOURCES;
  }
}

function clampStr(s, max = 160) {
  return String(s || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "fonte"; }
}

function absUrl(maybe, baseUrl) {
  try {
    return new URL(maybe, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickMeta(html, keys) {
  for (const k of keys) {
    // <meta property="og:image" content="...">
    let m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']+)["']`, "i"));
    if (m?.[1]) return clampStr(m[1], 600);
    // <meta content="..." property="...">
    m = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, "i"));
    if (m?.[1]) return clampStr(m[1], 600);
  }
  return "";
}

function pickFirstImg(html, baseUrl) {
  // fallback: primeira <img> útil quando OG/Twitter image não existe.
  // Evita logos/ícones comuns.
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = String(m[1] || "").trim();
    if (!src) continue;
    if (src.startsWith("data:")) continue;
    if (/\b(sprite|icon|logo|favicon)\b/i.test(src)) continue;
    if (/\.(svg)(\?|$)/i.test(src)) continue;
    const abs = absUrl(src, baseUrl);
    if (!abs) continue;
    return abs;
  }
  return "";
}

function cleanTitle(title, sourceName) {
  let t = clampStr(title, 220);
  const sn = String(sourceName || "").trim();
  if (!sn) return t;
  // 1) remove prefixo exato do tipo "Fonte - Título" / "Fonte — Título" / "Fonte: Título"
  const reExact = new RegExp(`^${sn.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*(?:[-—–:]\\s*)`, "i");
  t = t.replace(reExact, "");

  // 2) remove prefixo "parecido" quando a notícia já vem como "<algo> - Título"
  //    e esse <algo> tem forte relação com o nome da fonte (ex.: "Governo ES - ...").
  const m = t.match(/^(.{2,40}?)(?:\s*[-—–:]\s+)(.+)$/);
  if (m && m[2]) {
    const prefix = m[1].toLowerCase();
    const src = sn.toLowerCase();
    // se o prefixo compartilha pelo menos uma palavra "forte" com a fonte, considera duplicado.
    const strong = prefix.split(/\s+/).filter(w => w.length >= 3);
    if (strong.some(w => src.includes(w))) {
      t = m[2];
    }
  }

  return t.trim() || clampStr(title, 220);
}

function pickDate(html) {
  const candidates = [
    pickMeta(html, ["article:published_time", "og:updated_time"]),
    (html.match(/datetime=["']([^"']+)["']/i)?.[1] || ""),
    (html.match(/data-(?:published|publication|date)=["']([^"']+)["']/i)?.[1] || ""),
  ].map(s => String(s || "").trim()).filter(Boolean);

  for (const c of candidates) {
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // fallback: now
  return new Date();
}

async function fetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PontoViewBot/1.0; +https://pontoview.com.br)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function pickLinks(listHtml, baseUrl) {
  // Pega links "parecidos" com notícia (heurística genérica)
  const links = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(listHtml))) {
    const href = m[1];
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const abs = absUrl(href, baseUrl);
    if (!abs) continue;

    // evita arquivos
    if (abs.match(/\.(pdf|jpg|jpeg|png|webp)(\?|$)/i)) continue;

    // tenta focar em rotas típicas de notícia
    const ok =
      /noticia|noticias|imprensa|news|\/\d{4}\//i.test(abs) ||
      abs.includes(domainOf(baseUrl)); // garante que não fuja do domínio

    if (ok) links.add(abs);
    if (links.size >= MAX_PER_SOURCE * 2) break;
  }
  return [...links].slice(0, MAX_PER_SOURCE);
}

async function parseArticle(url, scope, meta = {}) {
  const html = await fetchText(url);

  const title =
    pickMeta(html, ["og:title", "twitter:title"]) ||
    clampStr((html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || ""));

  const image =
    pickMeta(html, ["og:image", "twitter:image", "twitter:image:src"]) ||
    pickFirstImg(html, url) ||
    "";

  const site =
    pickMeta(html, ["og:site_name"]) ||
    meta.sourceName ||
    domainOf(url);

  const published = pickDate(html);

  return {
    title: cleanTitle(title, meta.sourceName || site),
    url,
    image: absUrl(image, url) || null,
    source: site,
    publishedAt: published.toISOString(),
    scope,                    // local | state | national | health
    city: meta.city || null,  // só local
  };
}

function ageDays(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 9999;
  const diffMs = Date.now() - d.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

async function collectFromSource(src, scope) {
  try {
    const listHtml = await fetchText(src.url);
    const links = pickLinks(listHtml, src.url);

    const out = [];
    for (const link of links) {
      try {
        const item = await parseArticle(link, scope, { sourceName: src.name, city: src.city || null });
        if (!item.title) continue;
        if (ageDays(item.publishedAt) > MAX_AGE_DAYS) continue;
        out.push(item);
      } catch {
        // ignora item
      }
      // pequena pausa para não estressar fontes
      await sleep(250);
    }

    // ordena por data desc
    out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return out;
  } catch {
    return [];
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.url || it.title || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function interleaveByScope(groups, order) {
  const idx = Object.fromEntries(order.map(s => [s, 0]));
  const out = [];
  while (out.length < MAX_ITEMS_TOTAL) {
    let pushed = false;
    for (const s of order) {
      const g = groups[s] || [];
      if (!g.length) continue;
      const i = idx[s];
      if (i < g.length) {
        out.push(g[i]);
        idx[s] = i + 1;
        pushed = true;
        if (out.length >= MAX_ITEMS_TOTAL) break;
      }
    }
    if (!pushed) break;
  }
  return out;
}

async function main() {
  const sources = await readSources();

  const scopes = /** @type {const} */ (["local", "state", "national", "health"]);
  const collected = {};
  for (const scope of scopes) {
    collected[scope] = [];
    for (const src of sources[scope] || []) {
      const items = await collectFromSource(src, scope);
      collected[scope].push(...items);
    }
    collected[scope] = dedupe(collected[scope]);
  }

  // Se não tiver nada em um escopo, ele é removido do round-robin
  const order = scopes.filter(s => (collected[s] || []).length);

  // Intercala
  const finalItems = interleaveByScope(collected, order.length ? order : ["national"]);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), items: finalItems }, null, 2), "utf-8");

  console.log(`OK: ${OUT_FILE} (${finalItems.length} itens)`);
  const counts = Object.fromEntries(scopes.map(s => [s, (collected[s] || []).length]));
  console.log({ ...counts, final: finalItems.length, maxAgeDays: MAX_AGE_DAYS, sourceFile: SOURCES_FILE });
}

main().catch((e) => {
  console.error("ERRO build_news:", e);
  process.exitCode = 1;
});
