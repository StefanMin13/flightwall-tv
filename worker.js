// FlightWall TV – eigen proxy voor Cloudflare Workers (gratis tier: 100.000 verzoeken/dag).
// Gebruik in de pagina-instelling "Eigen proxy":  https://<naam>.<account>.workers.dev/?url=
//
// OpenSky (optioneel): zet in Cloudflare onder Worker → Settings → Variables and Secrets
// twee *secrets*: OPENSKY_CLIENT_ID en OPENSKY_CLIENT_SECRET (van opensky-network.org → Account → API Client).
// De Worker haalt dan zelf een OAuth2-token op en stuurt het mee; de sleutels komen nooit in de webpagina.
//
// FlyItalyADSB (aanbevolen reserve): gratis sleutel via flyitalyadsb.com → "Free API key".
// Zet als secret: FLYITALY_API_KEY. Data: CC BY-SA 4.0, © FlyItalyADSB (flyitalyadsb.com).
//
// GEDEELDE AANVRAAG: GET https://<worker>/shared
// Haalt één keer per ~12 s alle vliegtuigen binnen 60 km van SHARED op (dekt Sleidinge, Tiegem, Gent,
// Melle en Ursel met hun straal) en geeft dat aan elk scherm. Bron: adsb.lol → FlyItalyADSB → OpenSky.
const SHARED = { lat: 50.98, lon: 3.64, km: 60 };
const ALLOW = [
  "api.adsb.lol", "opendata.adsb.fi", "api.airplanes.live",
  "opensky-network.org", "api.adsbdb.com", "aviationweather.gov", "api.open-meteo.com",
  "api.planespotters.net", "api.flyitalyadsb.com"
];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Rate-Limit-Remaining, X-Rate-Limit-Retry-After-Seconds, X-OpenSky-Auth"
};
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
let osTok = null, osExp = 0;
async function openskyToken(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  if (osTok && Date.now() < osExp) return osTok;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return null;
  const j = await r.json();
  osTok = j.access_token; osExp = Date.now() + ((j.expires_in || 1800) - 120) * 1000;   // ruim voor afloop vernieuwen
  return osTok;
}
const err = (msg, status) => new Response(msg, { status, headers: CORS });

// ---- gedeelde ophaling ----
const blockedUntil = {};                       // bron → tijdstip (ms) tot wanneer we ze overslaan na 429/fout
function block(src, r, fallbackSec) {
  const ra = r && (+r.headers.get("Retry-After") || +r.headers.get("X-Rate-Limit-Retry-After-Seconds"));
  blockedUntil[src] = Date.now() + 1000 * (ra > 0 ? Math.min(ra, 900) : fallbackSec);
}
const UA = { "User-Agent": "FlightWallTV/1.0 (personal display)", "Accept": "application/json" };
async function srcAdsbLol() {
  const nm = Math.ceil(SHARED.km / 1.852);
  const r = await fetch(`https://api.adsb.lol/v2/point/${SHARED.lat}/${SHARED.lon}/${nm}`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) { block("adsb.lol", r, r.status === 429 ? 120 : 60); throw new Error("adsb.lol " + r.status); }
  return (await r.json()).ac || [];
}
async function srcFlyItaly(env) {
  if (!env.FLYITALY_API_KEY) throw new Error("flyitaly: geen sleutel");
  const r = await fetch(`https://api.flyitalyadsb.com/v2/lat/${SHARED.lat}/lon/${SHARED.lon}/dist/${SHARED.km}`,
    { headers: { ...UA, "X-Api-Key": env.FLYITALY_API_KEY }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) { block("flyitalyadsb", r, r.status === 429 ? 60 : 60); throw new Error("flyitaly " + r.status); }
  return (await r.json()).ac || [];
}
async function srcOpenSky(env) {
  const d = SHARED.km / 111 + 0.05, dl = d / Math.cos(SHARED.lat * Math.PI / 180);
  const u = `https://opensky-network.org/api/states/all?lamin=${(SHARED.lat - d).toFixed(3)}&lomin=${(SHARED.lon - dl).toFixed(3)}&lamax=${(SHARED.lat + d).toFixed(3)}&lomax=${(SHARED.lon + dl).toFixed(3)}`;
  const h = { ...UA }; try { const t = await openskyToken(env); if (t) h.Authorization = "Bearer " + t; } catch {}
  const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(9000) });
  if (!r.ok) { block("opensky", r, r.status === 429 ? 600 : 120); throw new Error("opensky " + r.status); }
  const j = await r.json();
  // omzetten naar hetzelfde formaat als adsb.lol (readsb/ADSBx v2)
  return (j.states || []).filter(s => s[5] != null && s[6] != null).map(s => ({
    hex: s[0], flight: s[1] || "", lat: s[6], lon: s[5],
    alt_baro: s[8] ? "ground" : Math.round((s[7] ?? s[13] ?? 0) * 3.28084),
    gs: (s[9] || 0) * 1.94384, track: s[10] || 0, baro_rate: Math.round((s[11] || 0) * 196.85), seen: 0
  }));
}
async function shared(env, ctx) {
  const cache = caches.default, key = new Request("https://fwtv.cache/shared-v1");
  const hit = await cache.match(key);
  if (hit) return hit;
  const tried = [];
  for (const [name, fn] of [["adsb.lol", srcAdsbLol], ["flyitalyadsb", srcFlyItaly], ["opensky", srcOpenSky]]) {
    if ((blockedUntil[name] || 0) > Date.now()) { tried.push(name + ": wacht"); continue; }
    try {
      const ac = await fn(env);
      const body = JSON.stringify({ src: name, now: Date.now(), center: SHARED, tried, ac });
      const res = new Response(body, { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=12", "X-FWTV-Source": name } });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) { tried.push(String(e.message || e)); }
  }
  return new Response(JSON.stringify({ error: "geen bron beschikbaar", tried }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
}
// ---- clubtoestellen: status van een vaste lijst toestellen (ook zonder positie) ----
// GET /club?hex=44d9b8,44a7d1,...  → FlyItalyADSB multi-lookup (telt als 1 aanvraag), anders adsb.lol per toestel.
async function club(url, env, ctx) {
  const hexes = [...new Set((url.searchParams.get("hex") || "").toLowerCase().split(",").filter(h => /^[0-9a-f]{6}$/.test(h)))].sort().slice(0, 50);
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=25" } });
  if (!hexes.length) return json({ src: null, ac: [] });
  const cache = caches.default, key = new Request("https://fwtv.cache/club-v1/" + hexes.join(","));
  const hit = await cache.match(key); if (hit) return hit;
  let ac = null, src = null; const tried = [];
  if (env.FLYITALY_API_KEY && !((blockedUntil["flyitalyadsb"] || 0) > Date.now())) {
    try {
      const r = await fetch(`https://api.flyitalyadsb.com/v2/icao/${hexes.join(",")}`, { headers: { ...UA, "X-Api-Key": env.FLYITALY_API_KEY }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { ac = (await r.json()).ac || []; src = "flyitalyadsb"; } else { if (r.status === 429) block("flyitalyadsb", r, 60); tried.push("flyitaly " + r.status); }
    } catch (e) { tried.push("flyitaly " + (e.name || e)); }
  }
  if (!ac && !((blockedUntil["adsb.lol"] || 0) > Date.now())) {
    const res = await Promise.all(hexes.map(h => fetch(`https://api.adsb.lol/v2/hex/${h}`, { headers: UA, signal: AbortSignal.timeout(8000) })
      .then(r => { if (r.status === 429) block("adsb.lol", r, 120); return r.ok ? r.json() : null; }).catch(() => null)));
    if (res.some(Boolean)) { ac = res.flatMap(j => (j && j.ac) || []); src = "adsb.lol"; } else tried.push("adsb.lol mislukt");
  }
  if (!ac) return json({ error: "geen bron", tried }, 503);
  const out = json({ src, now: Date.now(), tried, ac });
  ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (new URL(req.url).pathname === "/shared") return shared(env, ctx);
    if (new URL(req.url).pathname === "/club") return club(new URL(req.url), env, ctx);
    if (new URL(req.url).pathname === "/test") {             // diagnose: test één bron van de gedeelde aanvraag, zonder cache
      const name = new URL(req.url).searchParams.get("src");
      const fn = { "adsb.lol": srcAdsbLol, "flyitalyadsb": srcFlyItaly, "opensky": srcOpenSky }[name];
      if (!fn) return err("onbekende bron", 400);
      const t0 = Date.now();
      try { const ac = await fn(env); return new Response(JSON.stringify({ src: name, ok: true, count: ac.length, ms: Date.now() - t0,
          auth: name === "opensky" ? !!(env.OPENSKY_CLIENT_ID) : name === "flyitalyadsb" ? !!env.FLYITALY_API_KEY : null }),
          { headers: { ...CORS, "Content-Type": "application/json" } }); }
      catch (e) { return new Response(JSON.stringify({ src: name, ok: false, error: String(e.message || e), ms: Date.now() - t0 }),
          { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }); }
    }
    const target = new URL(req.url).searchParams.get("url");
    let t;
    try { t = new URL(target); } catch { return err("bad url", 400); }
    if (!ALLOW.includes(t.hostname)) return err("host not allowed", 403);
    const os = t.hostname === "opensky-network.org";
    const ttl = t.hostname === "aviationweather.gov" ? 300
      : (t.hostname === "api.adsbdb.com" || t.hostname === "api.planespotters.net") ? 3600
      : os ? 20 : 5;
    const headers = { "User-Agent": "FlightWallTV/1.0 (personal display)", "Accept": "application/json", "Content-Type": "application/json" };
    let authed = false;
    if (os) { try { const tok = await openskyToken(env); if (tok) { headers.Authorization = "Bearer " + tok; authed = true; } } catch {} }
    let r;
    try {
      r = await fetch(t.toString(), {
        method: req.method,
        body: req.method === "POST" ? await req.text() : undefined,
        headers,
        cf: { cacheTtl: ttl, cacheEverything: req.method === "GET" && !authed },
        signal: AbortSignal.timeout(os ? 9000 : 15000)
      });
    } catch (e) { return err("upstream timeout/error: " + (e && e.name), 504); }
    if (os && r.status === 401) osTok = null;                       // token ongeldig → volgende keer opnieuw
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    if (os) h.set("X-OpenSky-Auth", authed ? "yes" : "no");
    h.delete("set-cookie");
    return new Response(r.body, { status: r.status, headers: h });
  }
};
