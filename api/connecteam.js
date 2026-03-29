import https from "https";
import { URL } from "url";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "X-API-KEY, Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { path, ...queryParams } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing 'path' query parameter" });
  }

  const target = new URL(`https://api.connecteam.com/${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    target.searchParams.set(key, value);
  }

  const headers = {};
  if (req.headers["x-api-key"]) {
    headers["X-API-KEY"] = req.headers["x-api-key"];
  }

  return new Promise((resolve) => {
    const proxyReq = https.get(target.href, { headers }, (proxyRes) => {
      let body = "";
      proxyRes.on("data", (chunk) => (body += chunk));
      proxyRes.on("end", () => {
        res.status(proxyRes.statusCode);
        res.setHeader("Content-Type", "application/json");
        res.send(body);
        resolve();
      });
    });

    proxyReq.on("error", (err) => {
      res.status(502).json({ error: "Upstream request failed", details: err.message });
      resolve();
    });
  });
};
