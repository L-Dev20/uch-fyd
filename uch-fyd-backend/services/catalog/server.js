require("../../scripts/load-env");
process.env.SERVICE_NAME = "catalog";
const { randomUUID } = require("node:crypto");
const { query, mysqlTarget } = require("../../lib/mysql");
const { logError, installProcessDiagnostics } = require("../../lib/diagnostics");
const { createServiceServer, json, readJson, HttpError, requireInternal, listen } = require("../../lib/http");
installProcessDiagnostics("catalog");
const PORT = Number(process.env.CATALOG_PORT || 4102);
const SEED_PRODUCTS = [["Auriculares inalámbricos","Tecnología","Bluetooth, sonido envolvente y estuche de carga.",45990,22,"headphones","🎧","MÁS VENDIDO"],["Zapatillas urbanas","Deportes","Livianas y cómodas para todos los días.",68900,13,"sneaker","👟","NUEVO"],["Lámpara de mesa","Hogar","Luz cálida con diseño minimalista.",32750,8,"lamp","💡",""]];
function publicProduct(row) { return { id: String(row.id), name: row.name, category: row.category, description: row.description || "", price: Number(row.price), stock: Number(row.stock), type: row.type || "box", emoji: row.emoji || "📦", badge: row.badge || "", active: Boolean(row.active) }; }
function id(value) { if (!/^[0-9a-f-]{36}$/i.test(String(value))) throw new HttpError(400, "Identificador de producto inválido."); return String(value); }
function normalized(data, partial = false) {
  const result = {}; const names = { name: "name", nombre: "name", category: "category", categoria: "category", description: "description", descripcion: "description", price: "price", precio: "price", stock: "stock", type: "type", tipo: "type", emoji: "emoji", badge: "badge", activo: "active", active: "active" };
  for (const [key, value] of Object.entries(data)) if (names[key]) result[names[key]] = value;
  if (!partial && ["name", "category", "price", "stock"].some(key => result[key] === undefined || result[key] === "")) throw new HttpError(400, "Nombre, categoría, precio y stock son obligatorios.");
  if (result.price !== undefined && (!Number.isFinite(Number(result.price)) || Number(result.price) < 0)) throw new HttpError(400, "El precio debe ser un número igual o mayor que cero.");
  if (result.stock !== undefined && (!Number.isInteger(Number(result.stock)) || Number(result.stock) < 0)) throw new HttpError(400, "El stock debe ser un entero igual o mayor que cero.");
  if (result.active !== undefined && typeof result.active !== "boolean") throw new HttpError(400, "El estado del producto no es válido.");
  for (const key of ["price", "stock"]) if (result[key] !== undefined) result[key] = Number(result[key]); return result;
}
function filters(url) { const values = []; const clauses = ["activo=1"]; const text = url.searchParams.get("q"); const category = url.searchParams.get("categoria"); if (text) { values.push(`%${text}%`); clauses.push(`(nombre LIKE $${values.length} OR descripcion LIKE $${values.length} OR categoria LIKE $${values.length})`); } if (category) { values.push(category); clauses.push(`categoria=$${values.length}`); } if (url.searchParams.get("enStock") === "true") clauses.push("stock>0"); return { clauses, values }; }
const selectProduct = "id,nombre AS name,categoria AS category,descripcion AS description,precio AS price,stock,tipo AS type,emoji,insignia AS badge,activo AS active";
async function router(req, res) {
  const url = new URL(req.url, "http://catalog.local");
  if (url.pathname === "/health") { await query("SELECT 1"); return json(res, 200, { service: "catalog", status: "ok", database: "mysql" }); }
  if (req.method === "GET" && url.pathname === "/productos") { const { clauses, values } = filters(url); const rows = (await query(`SELECT ${selectProduct} FROM productos WHERE ${clauses.join(" AND ")} ORDER BY creado_en ASC LIMIT 300`, values)).rows; return json(res, 200, { items: rows.map(publicProduct) }); }
  const route = url.pathname.match(/^\/productos\/([^/]+)$/);
  if (req.method === "GET" && route) { const row = (await query(`SELECT ${selectProduct} FROM productos WHERE id=$1 AND activo=1`, [id(route[1])])).rows[0]; if (!row) throw new HttpError(404, "Producto no encontrado."); return json(res, 200, publicProduct(row)); }
  if (url.pathname === "/interno/productos" && req.method === "POST") { requireInternal(req); const data = normalized(await readJson(req)); const newId = randomUUID(); await query("INSERT INTO productos(id,nombre,categoria,descripcion,precio,stock,tipo,emoji,insignia,activo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)", [newId, data.name, data.category, data.description || "", data.price, data.stock, data.type || "box", data.emoji || "📦", data.badge || ""]); const row = (await query(`SELECT ${selectProduct} FROM productos WHERE id=$1`, [newId])).rows[0]; return json(res, 201, publicProduct(row)); }
  const internal = url.pathname.match(/^\/interno\/productos\/([^/]+)$/);
  if (internal && req.method === "PATCH") { requireInternal(req); const data = normalized(await readJson(req), true); if (!Object.keys(data).length) throw new HttpError(400, "No hay campos para actualizar."); const map = { name: "nombre", category: "categoria", description: "descripcion", price: "precio", stock: "stock", type: "tipo", emoji: "emoji", badge: "insignia", active: "activo" }; const set = []; const values = []; for (const [key, value] of Object.entries(data)) { values.push(value); set.push(`${map[key]}=$${values.length}`); } values.push(id(internal[1])); await query(`UPDATE productos SET ${set.join(",")},actualizado_en=CURRENT_TIMESTAMP WHERE id=$${values.length}`, values); const row = (await query(`SELECT ${selectProduct} FROM productos WHERE id=$1`, [internal[1]])).rows[0]; if (!row) throw new HttpError(404, "Producto no encontrado."); return json(res, 200, publicProduct(row)); }
  return json(res, 404, { error: "NOT_FOUND", message: "Ruta de catálogo no encontrada." });
}
async function start() { await query("CREATE TABLE IF NOT EXISTS productos(id CHAR(36) PRIMARY KEY,nombre VARCHAR(255) NOT NULL,categoria VARCHAR(120) NOT NULL,descripcion TEXT NOT NULL,precio DECIMAL(12,2) NOT NULL,stock INT NOT NULL,tipo VARCHAR(80) NOT NULL DEFAULT 'box',emoji VARCHAR(32) NOT NULL DEFAULT '📦',insignia VARCHAR(120) NOT NULL DEFAULT '',activo TINYINT(1) NOT NULL DEFAULT 1,creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)"); const count = Number((await query("SELECT COUNT(*) AS total FROM productos")).rows[0].total); if (!count) for (const item of SEED_PRODUCTS) await query("INSERT INTO productos(id,nombre,categoria,descripcion,precio,stock,tipo,emoji,insignia) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [randomUUID(), ...item]); listen(createServiceServer(router), PORT, "Servicio de Catálogo"); }
start().catch(error => { logError({ service: "catalog", stage: "startup_mysql", target: mysqlTarget() }, error); process.exit(1); });
