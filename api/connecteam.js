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

  const url = new URL(`https://api.connecteam.com/${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  const headers = {};
  if (req.headers["x-api-key"]) {
    headers["X-API-KEY"] = req.headers["x-api-key"];
  }

  // Retry with backoff on rate limiting
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url.href, { headers });

      if (response.status === 429) {
        // Rate limited — wait and retry
        const waitMs = Math.pow(2, attempt + 1) * 1500; // 3s, 6s, 12s, 24s
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      const data = await response.text();

      // Check for rate limit in response body too
      try {
        const parsed = JSON.parse(data);
        if (parsed?.detail?.includes?.("Too many requests")) {
          const waitMs = Math.pow(2, attempt + 1) * 1500;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
      } catch {}

      res.setHeader("Content-Type", "application/json");
      return res.status(response.status).send(data);
    } catch (err) {
      if (attempt === maxRetries - 1) {
        return res.status(502).json({ error: "Upstream request failed", details: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return res.status(429).json({ error: "Connecteam API rate limited after retries. Wait a moment and try again." });
}
