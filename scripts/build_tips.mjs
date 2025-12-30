import fs from "node:fs";
import path from "node:path";

const OUT = path.join("data", "tips.json");

// RSS oficiais (Ministério da Saúde / Saúde Brasil)
const FEEDS = [
  "https://www.gov.br/saude/pt-br/assuntos/saude-brasil/eu-quero-me-exercitar/RSS",
  "https://www.gov.br/saude/pt-br/assuntos/saude-brasil/eu-quero-me-alimentar-melhor/RSS",
];

const SOURCE_NAME = "Ministério da Saúde (gov.br)";
const SOURCE_LOGO = "https://www.gov.br/++theme++padrao_govbr/img/govbr-logo-large.png";

function clean(s=""){
  return String(s).replace(/\s+/g," ").trim();
}

function pickTag(xml, tag){
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? clean(m[1].replace(/<!\\[CDATA\\[|\\]\\]>/g,"").replace(/<[^>]+>/g,"")) : "";
}

function pickAllItems(xml){
  const items = [];
  const re = /<item[\s\S]*?>[\s\S]*?<\/item>/gi;
  const list = xml.match(re) || [];
  for(const it of list){
    const title = pickTag(it, "title");
    const link  = pickTag(it, "link");
    const pub   = pickTag(it, "pubDate") || pickTag(it, "dc:date");
    const desc  = pickTag(it, "description");
    // tenta imagem
    let img = "";
    const m1 = it.match(/<media:content[^>]+url="([^"]+)"/i);
    const m2 = it.match(/<enclosure[^>]+url="([^"]+)"/i);
    const m3 = it.match(/<img[^>]+src="([^"]+)"/i);
    img = (m1?.[1] || m2?.[1] || m3?.[1] || "").trim();

    items.push({
      id: clean(link || title),
      title,
      summary: desc,
      link,
      publishedAt: pub ? new Date(pub).toISOString() : null,
      imageUrl: img || null,
      source: SOURCE_NAME,
      sourceLogoUrl: SOURCE_LOGO,
    });
  }
  return items;
}

function lastDays(items, days=30){
  const cutoff = Date.now() - days*24*60*60*1000;
  return items.filter(x=>{
    const t = x.publishedAt ? Date.parse(x.publishedAt) : 0;
    return !t || t >= cutoff;
  });
}

async function fetchText(url){
  const r = await fetch(url, { headers: { "user-agent":"vyre-panels/1.0" }});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.text();
}

async function main(){
  const all = [];
  for(const url of FEEDS){
    const xml = await fetchText(url);
    all.push(...pickAllItems(xml));
  }

  // remove duplicados
  const map = new Map();
  for(const it of all){
    if(!it.title) continue;
    map.set(it.id, it);
  }

  const items = lastDays(Array.from(map.values()), 365)
    .sort((a,b)=>(Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)));

  fs.mkdirSync("data", { recursive:true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2), "utf-8");
  console.log(`OK: ${items.length} tips -> ${OUT}`);
}

main().catch(err=>{
  console.error(err);
  process.exit(1);
});
