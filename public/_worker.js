/* Ija Nbadlou — Cloudflare Pages worker ("advanced mode")
 *
 * Why: Facebook / WhatsApp / Telegram read the page's HTML *without running JavaScript*.
 * Our site is a single page whose listing data lives in Firebase, so a shared link would always
 * show the generic site card. This worker fills in the preview on the server:
 *
 *   /annonce/<id>   ->  the normal site (index.html) + title, description, og:image of THAT listing
 *   /og/<id>.jpg    ->  the first photo of that listing (stored as base64 in Firestore, decoded here)
 *   /               ->  the normal site + absolute og:image (default card)
 *
 * Everything else is served untouched by Cloudflare Pages (see _routes.json).
 * Only public data is read (listings are public: "allow read: if true" in the Firestore rules).
 */

const PROJECT_ID = "ija-nbadlo";                         // firebaseConfig.projectId
const API_KEY = "AIzaSyAOvAmGVrTgo5qhILdysEVyzYi2TmjDIeE"; // firebaseConfig.apiKey (public web key)

const firestoreBase = (env) => (env && env.FIRESTORE_BASE) || "https://firestore.googleapis.com";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => String(s == null ? "" : s)
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const clip = (s, n) => {
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
};

async function getListing(env, id, fields, origin) {
  const mask = fields.map((f) => "mask.fieldPaths=" + encodeURIComponent(f)).join("&");
  const url = firestoreBase(env) + "/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/listings/" +
    encodeURIComponent(id) + "?" + mask + "&key=" + API_KEY;
  try {
    const r = await fetch(url, { headers: { Referer: origin + "/" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.fields ? j.fields : null;
  } catch (e) {
    return null;
  }
}
const str = (f) => (f && typeof f.stringValue === "string" ? f.stringValue : "");

/* replace the head's title / description / canonical / og:* / twitter:* with ours */
function withMeta(html, m) {
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, () => "<title>" + esc(m.pageTitle) + "</title>")
    .replace(/<meta name="description"[^>]*>\s*/gi, "")
    .replace(/<link rel="canonical"[^>]*>\s*/gi, "")
    .replace(/<meta property="og:(?:type|title|description|url|image(?::[a-z_]+)?)"[^>]*>\s*/gi, "")
    .replace(/<meta name="twitter:(?:card|title|description|image(?::[a-z_]+)?)"[^>]*>\s*/gi, "");
  const tags = [
    '<meta name="description" content="' + esc(m.desc) + '">',
    '<link rel="canonical" href="' + esc(m.url) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="' + esc(m.ogTitle) + '">',
    '<meta property="og:description" content="' + esc(m.ogDesc) + '">',
    '<meta property="og:url" content="' + esc(m.url) + '">',
    '<meta property="og:image" content="' + esc(m.image) + '">',
    '<meta property="og:image:secure_url" content="' + esc(m.image) + '">',
    '<meta property="og:image:alt" content="' + esc(m.imageAlt) + '">',
    m.imgW ? '<meta property="og:image:width" content="' + m.imgW + '">' : "",
    m.imgW ? '<meta property="og:image:height" content="' + m.imgH + '">' : "",
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(m.ogTitle) + '">',
    '<meta name="twitter:description" content="' + esc(m.ogDesc) + '">',
    '<meta name="twitter:image" content="' + esc(m.image) + '">'
  ].filter(Boolean).join("\n");
  return html.replace("</head>", () => tags + "\n</head>");
}

const htmlResponse = (html, extra) =>
  new Response(html, {
    headers: Object.assign({ "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" }, extra || {})
  });

async function baseHtml(env, origin) {
  const r = await env.ASSETS.fetch(new Request(origin + "/"));
  return r.text();
}

/* "/" : same site, but with an absolute og:image so the home link also has a card */
async function homePage(env, request) {
  const origin = new URL(request.url).origin;
  const html = await baseHtml(env, origin);
  const pick = (re) => { const m = html.match(re); return m ? unesc(m[1]) : ""; };
  const pageTitle = pick(/<title>([\s\S]*?)<\/title>/i) || "Ija Nbadlou";
  const desc = pick(/<meta name="description" content="([^"]*)"/i);
  return htmlResponse(withMeta(html, {
    pageTitle: pageTitle,
    desc: desc,
    ogTitle: pick(/<meta property="og:title" content="([^"]*)"/i) || pageTitle,
    ogDesc: pick(/<meta property="og:description" content="([^"]*)"/i) || desc,
    url: origin + "/",
    image: origin + "/og-default.png", imgW: 1200, imgH: 630,
    imageAlt: "Ija Nbadlou — troc gratuit en Tunisie"
  }));
}

/* "/annonce/<id>" */
async function listingPage(env, request, id) {
  const origin = new URL(request.url).origin;
  const [html, f] = await Promise.all([
    baseHtml(env, origin),
    getListing(env, id, ["title", "desc", "want", "city", "status"], origin)
  ]);
  const url = origin + "/annonce/" + encodeURIComponent(id);
  if (!f || !str(f.title)) {
    // unknown / deleted listing: serve the site (it shows its own "not found") with the default card
    return htmlResponse(withMeta(html, {
      pageTitle: "Ija Nbadlou — نبدلو بلا فلوس | Troc gratuit en Tunisie",
      desc: "Ija Nbadlou : troc gratuit en Tunisie.",
      ogTitle: "Ija Nbadlou", ogDesc: "Troc gratuit en Tunisie — تبادل بلا فلوس",
      url: url, image: origin + "/og-default.png", imgW: 1200, imgH: 630, imageAlt: "Ija Nbadlou"
    }));
  }
  const title = clip(str(f.title), 80);
  const city = clip(str(f.city), 30);
  const want = clip(str(f.want), 70);
  const swapped = str(f.status) === "swapped";
  const bits = [];
  if (swapped) bits.push("✅ تبدّل / Échangé");
  if (str(f.desc)) bits.push(clip(str(f.desc), 120));
  if (want) bits.push("⇄ " + want);
  if (city) bits.push("📍 " + city);
  const ogTitle = title + (city ? " — " + city : "") + " | Ija Nbadlou";
  const ogDesc = bits.join(" • ");
  return htmlResponse(withMeta(html, {
    pageTitle: ogTitle, desc: ogDesc, ogTitle: ogTitle, ogDesc: ogDesc,
    url: url, image: origin + "/og/" + encodeURIComponent(id) + ".jpg", imageAlt: title
  }), { "cache-control": "public, max-age=0, s-maxage=30" });
}

/* "/og/<id>.jpg" : first photo of the listing, decoded from its base64 data URL */
async function listingImage(env, ctx, request, id) {
  const origin = new URL(request.url).origin;
  const cacheKey = new Request(origin + "/og/" + encodeURIComponent(id) + ".jpg");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const f = await getListing(env, id, ["imgs", "img"], origin);
  let src = "";
  if (f) {
    const arr = f.imgs && f.imgs.arrayValue && f.imgs.arrayValue.values;
    src = (arr && arr[0] && str(arr[0])) || str(f.img);
  }
  if (src.indexOf("data:image/") === 0) {
    const cut = src.indexOf(";base64,");
    if (cut > 0) {
      const mime = src.slice(5, cut);
      try {
        const bin = atob(src.slice(cut + 8));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const res = new Response(bytes, {
          headers: { "content-type": mime, "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" }
        });
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) { /* bad base64: fall through to the default card */ }
    }
  } else if (/^https:\/\//.test(src)) {
    return Response.redirect(src, 302);
  }
  const d = await env.ASSETS.fetch(new Request(origin + "/og-default.png"));
  return new Response(d.body, { status: 200, headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") {
      let m = url.pathname.match(/^\/og\/([A-Za-z0-9_-]{1,64})(?:\.jpe?g)?$/);
      if (m) return listingImage(env, ctx, request, m[1]);
      m = url.pathname.match(/^\/annonce\/([^/]+)\/?$/);
      if (m) {
        let id = m[1];
        try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
        if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) return listingPage(env, request, id);
      }
      if (url.pathname === "/") return homePage(env, request);
    }
    return env.ASSETS.fetch(request);
  }
};
