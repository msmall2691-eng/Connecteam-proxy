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

  try {
    const response = await fetch(url.href, { headers });
    const data = await response.text();

    res.setHeader("Content-Type", "application/json");
    return res.status(response.status).send(data);
  } catch (err) {
    return res.status(502).json({ error: "Upstream request failed", details: err.message });
  }
}
