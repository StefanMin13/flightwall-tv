# FlightWall TV

Live vluchten rond Sleidinge + METAR/TAF voor EBOS, EBBR en EBAW, voor weergave op een tv.

Instellingen: tandwiel of toets S, of via URL, bv. `?apts=EBOS,EBKT,EBBR&r=30`.

## Diagnose
Open `https://stefanmin13.github.io/flightwall-tv/?diag=1` (of druk **D**) om per databron te zien of ze direct of via een proxy bereikbaar is.

## Eigen proxy (aanbevolen voor 24/7)
1. Maak een gratis account op dash.cloudflare.com → *Workers & Pages* → *Create* → *Hello World* worker.
2. *Edit code* → plak de inhoud van `worker.js` → *Deploy*.
3. Open de FlightWall, druk **S** en vul bij "Eigen proxy" in: `https://<jouw-worker>.workers.dev/?url=`
