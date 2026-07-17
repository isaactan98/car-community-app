// The single place to configure the spike.
//
// RELAY_URL: where positions are sent.
//  - Same Wi-Fi: your laptop's LAN IP, e.g. "ws://192.168.1.23:4100"
//    (find it with `ipconfig getifaddr en0` on macOS)
//  - On the road (JB-SG drive test): a tunnel to the relay,
//    e.g. "wss://<something>.trycloudflare.com" via
//    `cloudflared tunnel --url http://localhost:4100`
export const RELAY_URL = "ws://192.168.1.23:4100";

// Free MapLibre style (OpenFreeMap). No API key, no Mapbox, no Google.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
