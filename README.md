# FlightWall TV

Live vluchten rond Sleidinge + METAR/TAF voor EBOS, EBBR en EBAW, voor weergave op een tv.

Instellingen: tandwiel of toets S, of via URL, bv. `?apts=EBOS,EBKT,EBBR&r=30`.

## Diagnose
Open `https://stefanmin13.github.io/flightwall-tv/?diag=1` (of druk **D**) om per databron te zien of ze direct of via een proxy bereikbaar is.

## Eigen proxy (aanbevolen voor 24/7)
1. Maak een gratis account op dash.cloudflare.com → *Workers & Pages* → *Create* → *Hello World* worker.
2. *Edit code* → plak de inhoud van `worker.js` → *Deploy*.
3. Open de FlightWall, druk **S** en vul bij "Eigen proxy" in: `https://<jouw-worker>.workers.dev/?url=`

## Tiegem
Aparte pagina: https://stefanmin13.github.io/flightwall-tv/tiegem/ (eigen standaardlocatie, luchthavens LFQQ/EBOS/EBBR en eigen opgeslagen instellingen).

## Gent
Aparte pagina: https://stefanmin13.github.io/flightwall-tv/gent/ (EBOS/EBBR/EBAW, eigen opgeslagen instellingen).

## Locaties
Klik op de locatienaam bovenaan (of toets L, of 1-5) om te kiezen uit Sleidinge, Tiegem, Gent, Melle en Ursel (EBUL, 10 km). De keuze wordt per browser bewaard. Via URL: `?loc=melle`.

## OpenSky als reservebron
1. Account op opensky-network.org → *Account* → *API Client* aanmaken → noteer `client_id` en `client_secret`.
2. Cloudflare → je Worker → *Settings* → *Variables and Secrets* → *Add*: type **Secret**, `OPENSKY_CLIENT_ID` en `OPENSKY_CLIENT_SECRET`.
3. Plak de nieuwste `worker.js` via *Edit code* → *Deploy*.
4. Controle: `?diag=1` → rij OpenSky toont "OK · ingelogd".
