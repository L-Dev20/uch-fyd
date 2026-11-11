require("../../scripts/load-env");
const { randomUUID } = require("node:crypto");
const { createServiceServer, json, rawBody, listen, HttpError } = require("../../lib/http");
const PORT = Number(process.env.GATEWAY_PORT || 4100);
const routes = [
  ["/api/v1/identidad", process.env.IDENTITY_URL || "http://localhost:4101"],
  ["/api/v1/catalogo", process.env.CATALOG_URL || "http://localhost:4102"],
  ["/api/v1/pedidos", process.env.ORDERS_URL || "http://localhost:4103"]
];
const rate = new Map();
function checkRate(ip) {
  const now = Date.now(); let record = rate.get(ip);
  if (!record || record.until < now) record = { count: 0, until: now + 60_000 };
  record.count += 1; rate.set(ip, record);
  if (record.count > 180) throw new HttpError(429, "Demasiadas solicitudes. Intentá nuevamente en un minuto.");
  if (rate.size > 4000) for (const [key, value] of rate) if (value.until < now) rate.delete(key);
}
const localCorsOrigins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5500,http://127.0.0.1:5500,null";
const corsOrigins = process.env.NODE_ENV === "development" ? [process.env.ALLOWED_ORIGIN, localCorsOrigins].filter(Boolean).join(",") : (process.env.ALLOWED_ORIGIN || "http://localhost:5173");
const server = createServiceServer(async (req, res, requestId) => {
  const url = new URL(req.url, "http://gateway.local");
  if (url.pathname === "/health") return json(res, 200, { service: "gateway", status: "ok" });
  checkRate(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown");
  const selected = routes.find(([prefix]) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
  if (!selected) return json(res, 404, { error: "NOT_FOUND", message: "Ruta del API Gateway no encontrada.", requestId });
  const [prefix, origin] = selected;
  const upstreamPath = url.pathname.slice(prefix.length) || "/";
  const target = new URL(`${upstreamPath}${url.search}`, origin);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await rawBody(req);
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        ...(req.headers["idempotency-key"] ? { "Idempotency-Key": req.headers["idempotency-key"] } : {}),
        "X-Request-Id": requestId,
        "X-Forwarded-For": `${req.headers["x-forwarded-for"] || ""}${req.headers["x-forwarded-for"] ? ", " : ""}${req.socket.remoteAddress || "unknown"}`,
        "X-Forwarded-Proto": req.headers["x-forwarded-proto"] || "http"
      },
      body,
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    console.error(JSON.stringify({ requestId, upstream: target.origin, message: error.message }));
    return json(res, 503, { error: "UPSTREAM_UNAVAILABLE", message: "El servicio está temporalmente no disponible.", requestId });
  }
  const responseBody = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId
  });
  res.end(responseBody);
}, { corsOrigin: corsOrigins });
listen(server, PORT, "API Gateway");
