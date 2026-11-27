// FlightWall TV – eigen proxy voor Cloudflare Workers (gratis tier: 100.000 verzoeken/dag).
// Gebruik in de pagina-instelling "Eigen proxy":  https://<naam>.<account>.workers.dev/?url=
//
// OpenSky (optioneel): zet in Cloudflare onder Worker → Settings → Variables and Secrets
// twee *secrets*: OPENSKY_CLIENT_ID en OPENSKY_CLIENT_SECRET (van opensky-network.org → Account → API Client).
// De Worker haalt dan zelf een OAuth2-token op en stuurt het mee; de sleutels komen nooit in de webpagina.
const ALLOW = [
  "api.adsb.lol", "opendata.adsb.fi", "api.airplanes.live",
  "opensky-network.org", "api.adsbdb.com", "aviationweather.gov", "api.open-meteo.com",
  "api.planespotters.net"
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
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
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
