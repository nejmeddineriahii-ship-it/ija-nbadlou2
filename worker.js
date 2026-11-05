/* Ija Nbadlou — Cloudflare Worker (optionnel mais recommandé pour le SEO)
 *
 * Ce que fait ce Worker, en plus de servir les fichiers du dossier public/ :
 *   /annonce/<id>        -> la même page, mais avec le titre, la description et la photo de l'annonce
 *                           dans le HTML (Google, WhatsApp et Facebook les lisent sans exécuter de JavaScript)
 *   /img/<id>/<n>        -> la photo n° n de l'annonce, en vrai fichier image (pour la vignette de partage)
 *   /sitemap.xml         -> sitemap généré depuis Firestore : une URL par annonce disponible
 *
 * Lecture seule : il utilise l'API REST de Firestore avec la clé web publique du projet
 * (la même que dans index.html), donc il fonctionne tant que les règles Firestore autorisent la lecture publique
 * des annonces — ce qui est déjà le cas puisque le site les affiche à tout le monde.
 */

const PROJECT_ID = "ija-nbadlo";
const API_KEY = "AIzaSyAOvAmGVrTgo5qhILdysEVyzYi2TmjDIeE";
const SITE = "https://ija-nbadlou.tn";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/* ------------------------------------------------------------------ helpers (exportés pour les tests) */

export function fromValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}

export function fromFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = fromValue(fields[k]);
  return out;
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function trunc(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  const type = m[1] || "image/jpeg";
  if (!m[2]) return { type, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type, bytes };
}

export function listingImages(l) {
  if (l && Array.isArray(l.imgs) && l.imgs.length) return l.imgs;
  if (l && l.img) return [l.img];
  return [];
}

export function buildMeta(id, l) {
  const title = `${l.title || "Annonce"}${l.city ? " — " + l.city : ""} | Ija Nbadlou`;
  const parts = [];
  if (l.desc) parts.push(l.desc);
  if (l.want) parts.push(`Contre : ${l.want}`);
  parts.push(`Troc gratuit${l.city ? " à " + l.city : " en Tunisie"}`);
  const description = trunc(parts.join(" • "), 200);
  const url = `${SITE}/annonce/${encodeURIComponent(id)}`;
  const hasImg = listingImages(l).length > 0;
  const image = hasImg ? `${SITE}/img/${encodeURIComponent(id)}/0` : `${SITE}/icons/icon-512.png`;
  return { title, description, url, image, hasImg };
}

export function sitemapXml(docs) {
  const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
  const urls = [
    `<url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${SITE}/a-propos</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
  ];
  for (const d of docs) {
    if (!d.id || d.status === "swapped") continue;
    const last = iso(d.createdAt);
    urls.push(
      `<url><loc>${SITE}/annonce/${esc(encodeURIComponent(d.id))}</loc>` +
        (last ? `<lastmod>${last}</lastmod>` : "") +
        `<changefreq>weekly</changefreq><priority>0.7</priority></url>`
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/* ------------------------------------------------------------------ Firestore REST */

async function getListing(id, fetchImpl = fetch) {
  const res = await fetchImpl(`${FS_BASE}/listings/${encodeURIComponent(id)}?key=${API_KEY}`, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error("firestore " + res.status);
  const doc = await res.json();
  return { listing: fromFields(doc.fields || {}) };
}

async function listAll(fetchImpl = fetch) {
  const res = await fetchImpl(`${FS_BASE}:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "listings" }],
        select: { fields: [{ fieldPath: "createdAt" }, { fieldPath: "status" }] },
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: 1000,
      },
    }),
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error("firestore " + res.status);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const id = r.document.name.split("/").pop();
      return { id, ...fromFields(r.document.fields || {}) };
    });
}

/* ------------------------------------------------------------------ routes */

async function serveIndex(request, env) {
  return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
}

async function listingPage(request, env, id) {
  const indexRes = await serveIndex(request, env);
  let result;
  try {
    result = await getListing(id);
  } catch (e) {
    return indexRes; // Firestore indisponible : la page normale (le site charge l'annonce lui-même)
  }
  if (result.missing) {
    return new Response(indexRes.body, { status: 404, headers: indexRes.headers });
  }
  const m = buildMeta(id, result.listing);
  // setAttribute échappe déjà les guillemets ; on neutralise aussi < et > par prudence
  const attrSafe = (v) => String(v).replace(/</g, "‹").replace(/>/g, "›");
  const setContent = (name) => ({
    element(e) { e.setAttribute("content", attrSafe(name === "title" ? m.title : m.description)); },
  });
  const rewriter = new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(m.title); } })
    .on('meta[name="description"]', setContent("description"))
    .on('meta[property="og:title"]', setContent("title"))
    .on('meta[property="og:description"]', setContent("description"))
    .on('meta[property="og:url"]', { element(e) { e.setAttribute("content", m.url); } })
    .on('meta[name="twitter:title"]', setContent("title"))
    .on('meta[name="twitter:description"]', setContent("description"))
    .on('meta[name="twitter:card"]', { element(e) { e.setAttribute("content", "summary_large_image"); } })
    .on('link[rel="canonical"]', { element(e) { e.setAttribute("href", m.url); } })
    .on("head", {
      element(e) {
        e.append(
          `<meta property="og:image" content="${esc(m.image)}">` +
            `<meta name="twitter:image" content="${esc(m.image)}">` +
            `<meta property="og:image:alt" content="${esc(m.title)}">`,
          { html: true }
        );
      },
    });
  const out = rewriter.transform(indexRes);
  const headers = new Headers(out.headers);
  headers.set("cache-control", "public, max-age=300");
  return new Response(out.body, { status: 200, headers });
}

async function imageRoute(id, n) {
  const { listing, missing } = await getListing(id);
  if (missing) return new Response("not found", { status: 404 });
  const imgs = listingImages(listing);
  const parsed = parseDataUrl(imgs[n] || imgs[0]);
  if (!parsed) return new Response("no image", { status: 404 });
  return new Response(parsed.bytes, {
    headers: {
      "content-type": parsed.type,
      "cache-control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

async function sitemapRoute() {
  const docs = await listAll();
  return new Response(sitemapXml(docs), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (request.method === "GET" || request.method === "HEAD") {
        if (p === "/sitemap.xml") return await sitemapRoute();
        let m = p.match(/^\/img\/([^/]+)\/(\d+)(?:\.\w+)?$/);
        if (m) return await imageRoute(decodeURIComponent(m[1]), Number(m[2]));
        m = p.match(/^\/annonce\/([^/]+)\/?$/);
        if (m) return await listingPage(request, env, decodeURIComponent(m[1]));
      }
    } catch (e) {
      // en cas de souci on retombe sur les fichiers statiques (le sitemap statique, la page normale…)
    }
    return env.ASSETS.fetch(request);
  },
};
