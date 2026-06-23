import type express from "express";
import { ENV } from "./env";

const MAPS_PROXY_PREFIX = "/api/maps/proxy";
const ALLOWED_UPSTREAM_PREFIXES = ["/maps/api/"];

function appendQuery(url: URL, query: express.Request["query"]) {
  for (const [key, value] of Object.entries(query)) {
    if (key === "key" || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined) continue;
      url.searchParams.append(key, String(item));
    }
  }
}

export function registerMapsProxyRoutes(app: express.Express) {
  app.get(`${MAPS_PROXY_PREFIX}/*`, async (req, res) => {
    try {
      const baseUrl = ENV.forgeApiUrl.replace(/\/+$/, "");
      const apiKey = ENV.forgeApiKey;

      if (!baseUrl || !apiKey) {
        res.status(503).json({ success: false, error: "Maps proxy nao configurado." });
        return;
      }

      const upstreamPath = req.path.slice(MAPS_PROXY_PREFIX.length);
      if (!ALLOWED_UPSTREAM_PREFIXES.some((prefix) => upstreamPath.startsWith(prefix))) {
        res.status(404).json({ success: false, error: "Endpoint de mapa nao permitido." });
        return;
      }

      const upstreamUrl = new URL(`/v1/maps/proxy${upstreamPath}`, `${baseUrl}/`);
      appendQuery(upstreamUrl, req.query);
      upstreamUrl.searchParams.set("key", apiKey);

      const response = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
          Accept: req.headers.accept || "*/*",
        },
      });

      const contentType = response.headers.get("content-type");
      const cacheControl = response.headers.get("cache-control");
      if (contentType) res.setHeader("Content-Type", contentType);
      if (cacheControl) res.setHeader("Cache-Control", cacheControl);
      else res.setHeader("Cache-Control", response.ok ? "public, max-age=3600" : "no-store");

      const body = Buffer.from(await response.arrayBuffer());
      res.status(response.status).send(body);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[MapsProxy] request failed", error);
      res.status(502).json({ success: false, error: "Falha ao carregar mapa." });
    }
  });
}
