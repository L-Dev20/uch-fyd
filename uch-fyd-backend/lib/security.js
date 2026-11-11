const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { HttpError } = require("./http");
const scrypt = promisify(crypto.scrypt);
const SECRET = process.env.JWT_SECRET || "dev-only-change-this-secret-before-deploy";

function b64url(value) { return Buffer.from(value).toString("base64url"); }
function signToken(user) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: String(user.id), email: user.email, role: user.role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 4, iss: "uch-fyd" }));
  const input = `${header}.${payload}`;
  return `${input}.${crypto.createHmac("sha256", SECRET).update(input).digest("base64url")}`;
}
function verifyToken(token) {
  if (!token) throw new HttpError(401, "Se requiere iniciar sesión.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Token inválido.");
  const input = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", SECRET).update(input).digest();
  let actual;
  try { actual = Buffer.from(parts[2], "base64url"); } catch { throw new HttpError(401, "Token inválido."); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new HttpError(401, "Token inválido.");
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { throw new HttpError(401, "Token inválido."); }
  if (payload.iss !== "uch-fyd" || !payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) throw new HttpError(401, "La sesión expiró.");
  return payload;
}
function bearer(req) { return (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || ""; }
function authenticate(req) { return verifyToken(bearer(req)); }
function authorize(user, ...roles) { if (roles.length && !roles.includes(user.role)) throw new HttpError(403, "No tenés permiso para esta acción."); }
async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("hex") };
}
async function checkPassword(password, salt, expectedHex) {
  const actual = Buffer.from(await scrypt(password, salt, 64)); const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
module.exports = { signToken, verifyToken, bearer, authenticate, authorize, hashPassword, checkPassword };
