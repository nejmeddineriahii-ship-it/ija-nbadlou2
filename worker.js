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
    if (!d.id || d.status === "swapped" || d.status === "pending" || d.status === "rejected") continue;
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


/* ------------------------------------------------------------------ nouvelle annonce -> Telegram */

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// Vérifie un jeton Firebase (RS256) et renvoie son contenu, ou null s'il est invalide
export async function verifyFirebaseToken(token, fetchImpl = fetch, now = Date.now()) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (header.alg !== "RS256" || !header.kid) return null;
    const sec = Math.floor(now / 1000);
    if (payload.aud !== PROJECT_ID) return null;
    if (payload.iss !== "https://securetoken.google.com/" + PROJECT_ID) return null;
    if (!payload.sub || typeof payload.exp !== "number" || payload.exp < sec) return null;
    if (typeof payload.iat === "number" && payload.iat > sec + 300) return null;
    const res = await fetchImpl("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) return null;
    const jwk = (await res.json()).keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const okSig = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    return okSig ? payload : null;
  } catch (e) {
    return null;
  }
}

export function telegramText(id, l) {
  const lines = [
    "🆕 Annonce à valider",
    "",
    `📦 ${trunc(l.title, 60)}`,
    `📍 ${l.city || "?"} · ${l.category || "?"}`,
    `👤 ${trunc(l.owner, 30)} · 📞 ${trunc(l.phone, 20)}`,
  ];
  if (l.desc) lines.push(`📝 ${trunc(l.desc, 160)}`);
  if (l.want) lines.push(`⇄ ${trunc(l.want, 80)}`);
  lines.push("", `${SITE}/admin#${id}`);
  return lines.join("\n");
}

async function newListingRoute(request, env) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = await verifyFirebaseToken(token);
  if (!payload) return json({ ok: false, error: "auth" }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "body" }, 400); }
  const id = String((body && body.id) || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return json({ ok: false, error: "id" }, 400);

  // on lit l'annonce AVEC le jeton de l'utilisateur : les règles Firestore garantissent qu'elle existe
  const res = await fetch(`${FS_BASE}/listings/${encodeURIComponent(id)}`, { headers: { authorization: "Bearer " + token } });
  if (!res.ok) return json({ ok: false, error: "listing" }, 404);
  const l = fromFields((await res.json()).fields || {});
  if (l.ownerUid !== payload.sub || l.status !== "pending") return json({ ok: false, error: "state" }, 403);

  // une seule notification par annonce
  const cache = caches.default;
  const marker = new Request(`${SITE}/__notified/${id}`);
  if (await cache.match(marker)) return json({ ok: true, duplicate: true });
  await cache.put(marker, new Response("1", { headers: { "cache-control": "public, max-age=86400" } }));

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ ok: false, error: "telegram-not-configured" }, 200);
  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: telegramText(id, l), disable_web_page_preview: true }),
  });
  return json({ ok: tg.ok });
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
  if (result.listing && (result.listing.status === "pending" || result.listing.status === "rejected")) {
    return indexRes; // annonce pas encore validée : pas d'aperçu public
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
    // on retire les balises image par défaut de la page d'accueil avant d'ajouter celles de l'annonce
    .on('meta[property="og:image"]', { element(e) { e.remove(); } })
    .on('meta[property="og:image:width"]', { element(e) { e.remove(); } })
    .on('meta[property="og:image:height"]', { element(e) { e.remove(); } })
    .on('meta[name="twitter:image"]', { element(e) { e.remove(); } })
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
      if (request.method === "POST" && p === "/api/new-listing") return await newListingRoute(request, env);
      if (request.method === "GET" || request.method === "HEAD") {
        if (p === "/__ija") {
          // diagnostic : /__ija?id=<id de l'annonce>
          const id = url.searchParams.get("id") || "";
          let out = "worker: ok\nproject: " + PROJECT_ID + "\n";
          try {
            const r = await getListing(id);
            out += r.missing ? "annonce: introuvable (404)\n" : "annonce: ok, titre = " + (r.listing.title || "?") + "\n";
          } catch (e) { out += "firestore: ERREUR " + e.message + "\n"; }
          out += "telegram token: " + (env.TELEGRAM_BOT_TOKEN ? "présent" : "ABSENT") + "\n";
          out += "telegram chat id: " + (env.TELEGRAM_CHAT_ID ? "présent" : "ABSENT") + "\n";
          if (url.searchParams.get("tg") && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
            // message de test (1 par minute au maximum)
            const cache = caches.default;
            const mk = new Request(`${SITE}/__tgtest/${Math.floor(Date.now() / 60000)}`);
            if (await cache.match(mk)) {
              out += "test telegram: attends 1 minute avant de réessayer\n";
            } else {
              await cache.put(mk, new Response("1", { headers: { "cache-control": "public, max-age=90" } }));
              try {
                const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: "✅ Test Ija Nbadlou : les notifications marchent." }),
                });
                const j = await tg.json().catch(() => ({}));
                out += "test telegram: " + (j.ok ? "ENVOYÉ ✅" : "ERREUR " + tg.status + " " + (j.description || "")) + "\n";
              } catch (e) { out += "test telegram: ERREUR " + e.message + "\n"; }
            }
          }
          return new Response(out, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
        }
        if (p === "/sitemap.xml") return await sitemapRoute();
        let m = p.match(/^\/img\/([^/]+)\/(\d+)(?:\.\w+)?$/);
        if (m) return await imageRoute(decodeURIComponent(m[1]), Number(m[2]));
        m = p.match(/^\/annonce\/([^/]+)\/?$/);
        if (m) {
          if (url.searchParams.get("debug")) {
            const r = await serveIndex(request, env);
            const txt = await r.clone().text();
            return new Response(
              "index status: " + r.status + "\ncontent-type: " + r.headers.get("content-type") +
                "\nlength: " + txt.length + "\nhas og:image tag: " + /og:image/.test(txt) + "\n",
              { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }
            );
          }
          return await listingPage(request, env, decodeURIComponent(m[1]));
        }
      }
    } catch (e) {
      if (url.searchParams.get("debug")) {
        return new Response("ERREUR: " + (e && e.stack || e), { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      // en cas de souci on retombe sur les fichiers statiques (le sitemap statique, la page normale…)
    }
    return env.ASSETS.fetch(request);
  },
};
