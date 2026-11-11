require("../../scripts/load-env");
process.env.SERVICE_NAME = "identity-admin";
const { MongoClient, ObjectId } = require("mongodb");
const { createServiceServer, json, readJson, HttpError, callInternal, listen } = require("../../lib/http");
const { hashPassword, checkPassword, signToken, authenticate, authorize, bearer } = require("../../lib/security");
const { logError, installProcessDiagnostics } = require("../../lib/diagnostics");
installProcessDiagnostics("identity-admin");
const PORT = Number(process.env.IDENTITY_PORT || 4101);
const client = new MongoClient(process.env.MONGODB_URL || "mongodb://localhost:27017/?replicaSet=rs0", { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
let users;
const CATALOG_URL = process.env.CATALOG_URL || "http://localhost:4102";
const ORDERS_URL = process.env.ORDERS_URL || "http://localhost:4103";
function view(user) { return { id: String(user._id), name: user.name, email: user.email, role: user.role, active: user.active }; }
function validateCredentials(data, registration = false) {
  const email = String(data.email || "").trim().toLowerCase(); const password = String(data.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Ingresá un correo electrónico válido.");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
  if (registration && String(data.name || "").trim().length < 2) throw new HttpError(400, "Ingresá tu nombre completo.");
  return { email, password };
}
async function seedAdministrator() {
  const email = String(process.env.ADMIN_EMAIL || "admin@uchfyd.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "change-this-local-admin-password";
  const existing = await users.findOne({ email });
  if (!existing) {
    const credentials = await hashPassword(password);
    await users.insertOne({ email, name: "Administración UCH-FyD", role: "admin", active: true, ...credentials, createdAt: new Date() });
    console.log(`Administrador inicial creado: ${email}`);
  }
}
function getAdmin(req) { const identity = authenticate(req); authorize(identity, "admin"); return identity; }
async function router(req, res, requestId) {
  const url = new URL(req.url, "http://identity.local");
  if (url.pathname === "/health") { await client.db("admin").command({ ping: 1 }); return json(res, 200, { service: "identity-admin", status: "ok" }); }
  if (url.pathname === "/registro" && req.method === "POST") {
    const data = await readJson(req); const { email, password } = validateCredentials(data, true);
    if (await users.findOne({ email })) throw new HttpError(409, "Ya existe una cuenta con ese correo.");
    const credentials = await hashPassword(password);
    const result = await users.insertOne({ email, name: String(data.name).trim(), role: "client", active: false, ...credentials, createdAt: new Date() });
    return json(res, 201, { status: "pending_activation", message: "La cuenta quedó pendiente de activación por administración.", user: { id: String(result.insertedId), name: String(data.name).trim(), email, role: "client", active: false } });
  }
  if (url.pathname === "/login" && req.method === "POST") {
    const { email, password } = validateCredentials(await readJson(req));
    const user = await users.findOne({ email });
    if (!user || !(await checkPassword(password, user.salt, user.hash))) throw new HttpError(401, "Correo o contraseña incorrectos.");
    if (!user.active) throw new HttpError(403, "Tu cuenta todavía está pendiente de activación.");
    const profile = view(user);
    return json(res, 200, { accessToken: signToken(profile), tokenType: "Bearer", expiresIn: 14400, user: profile });
  }
  if (url.pathname === "/usuario" && req.method === "GET") {
    const identity = authenticate(req); const user = await users.findOne({ _id: new ObjectId(identity.sub), active: true });
    if (!user) throw new HttpError(401, "La cuenta no está activa.");
    return json(res, 200, { user: view(user) });
  }
  if (url.pathname === "/administracion/usuarios" && req.method === "GET") {
    getAdmin(req); const items = await users.find({}, { projection: { hash: 0, salt: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
    return json(res, 200, { items: items.map(view) });
  }
  const userAction = url.pathname.match(/^\/administracion\/usuarios\/([^/]+)\/(activar|rol)$/);
  if (userAction && req.method === "PATCH") {
    getAdmin(req); if (!ObjectId.isValid(userAction[1])) throw new HttpError(400, "Identificador de usuario inválido.");
    const data = await readJson(req); const update = {};
    if (userAction[2] === "activar") update.active = Boolean(data.active ?? true);
    else { if (!["client", "admin"].includes(data.role)) throw new HttpError(400, "El rol debe ser client o admin."); update.role = data.role; }
    const result = await users.findOneAndUpdate({ _id: new ObjectId(userAction[1]) }, { $set: update }, { returnDocument: "after", projection: { hash: 0, salt: 0 } });
    if (!result) throw new HttpError(404, "Usuario no encontrado.");
    return json(res, 200, { user: view(result) });
  }
  if (url.pathname === "/administracion/productos" && req.method === "POST") {
    getAdmin(req); const result = await callInternal(`${CATALOG_URL}/interno/productos`, { method: "POST", body: await readJson(req), token: bearer(req), requestId });
    return json(res, 201, result);
  }
  const productAction = url.pathname.match(/^\/administracion\/productos\/([^/]+)$/);
  if (productAction && req.method === "PATCH") {
    getAdmin(req); const result = await callInternal(`${CATALOG_URL}/interno/productos/${encodeURIComponent(productAction[1])}`, { method: "PATCH", body: await readJson(req), token: bearer(req), requestId });
    return json(res, 200, result);
  }
  if (url.pathname === "/administracion/pedidos" && req.method === "GET") {
    getAdmin(req); const result = await callInternal(`${ORDERS_URL}/interno/administracion/pedidos${url.search}`, { token: bearer(req), requestId });
    return json(res, 200, result);
  }
  return json(res, 404, { error: "NOT_FOUND", message: "Ruta de Identidad/Administración no encontrada." });
}

async function start() {
  try { await client.connect(); }
  catch (error) {
    logError({ service: "identity-admin", stage: "mongodb_connect", database: "uchfyd_identity", configured: Boolean(process.env.MONGODB_URL) }, error);
    throw error;
  }
  users = client.db("uchfyd_identity").collection("usuarios");
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ active: 1, role: 1 });
  await seedAdministrator();
  const server = createServiceServer(router); listen(server, PORT, "Servicio de Identidad y Administración");
}
start().catch(error => { logError({ service: "identity-admin", stage: "startup" }, error); process.exit(1); });
