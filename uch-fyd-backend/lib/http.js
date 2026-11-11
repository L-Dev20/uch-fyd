const http = require("node:http");
const { randomUUID } = require("node:crypto");

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
function json(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(payload);
}
async function rawBody(req, limit = 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new HttpError(413, "El cuerpo de la solicitud supera el límite permitido."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const raw = await rawBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString("utf8")); }
  catch { throw new HttpError(400, "El cuerpo debe ser JSON válido."); }
}
function createServiceServer(router, options = {}) {
  const server = http.createServer(async (req, res) => {
    const requestId = req.headers["x-request-id"] || randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (options.corsOrigin) {
      const origin = req.headers.origin;
      const allowedOrigins = String(options.corsOrigin).split(",").map(value => value.trim()).filter(Boolean);
      if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-Id");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    }
    try { await router(req, res, requestId); }
    catch (error) {
      if (res.headersSent) return res.destroy(error);
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) console.error(JSON.stringify({ requestId, message: error.message, stack: error.stack }));
      json(res, status, { error: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: status >= 500 ? "Ocurrió un error interno." : error.message, ...(error.details ? { details: error.details } : {}), requestId });
    }
  });
  return server;
}
function requireInternal(req) {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected || req.headers["x-internal-service-key"] !== expected) throw new HttpError(403, "Acceso interno denegado.");
}
async function callInternal(url, { method = "GET", body, token, requestId } = {}) {
  const headers = { "X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY || "", "X-Request-Id": requestId || "" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  } catch (cause) { throw Object.assign(new HttpError(503, "Servicio interno no disponible."), { cause }); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, result.message || "Error en servicio interno.", result.details);
  return result;
}
function listen(server, port, name) { server.listen(port, "0.0.0.0", () => console.log(`${name} escuchando en ${port}`)); }
module.exports = { HttpError, json, rawBody, readJson, createServiceServer, requireInternal, callInternal, listen };
