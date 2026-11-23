// FlightWall TV – eigen CORS-proxy voor Cloudflare Workers (gratis tier: 100.000 verzoeken/dag).
// Gebruik in de pagina-instelling "Eigen proxy":  https://<naam>.<account>.workers.dev/?url=
const ALLOW = [
  "api.adsb.lol", "opendata.adsb.fi", "api.airplanes.live",
  "opensky-network.org", "api.adsbdb.com", "aviationweather.gov"
];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const target = new URL(req.url).searchParams.get("url");
    let t;
    try { t = new URL(target); } catch { return new Response("bad url", { status: 400, headers: CORS }); }
    if (!ALLOW.includes(t.hostname)) return new Response("host not allowed", { status: 403, headers: CORS });
    const ttl = t.hostname === "aviationweather.gov" ? 300 : t.hostname === "api.adsbdb.com" ? 3600 : 5;
    const r = await fetch(t.toString(), {
      method: req.method,
      body: req.method === "POST" ? await req.text() : undefined,
      headers: { "User-Agent": "FlightWallTV/1.0 (personal display)", "Accept": "application/json", "Content-Type": "application/json" },
      cf: { cacheTtl: ttl, cacheEverything: req.method === "GET" }
    });
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    h.delete("set-cookie");
    return new Response(r.body, { status: r.status, headers: h });
  }
};
