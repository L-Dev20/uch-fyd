
require("../../scripts/load-env");

process.env.SERVICE_NAME = "orders";

const {
  logError,
  installProcessDiagnostics
} = require("../../lib/diagnostics");

installProcessDiagnostics("orders");

const { randomUUID, createHash } = require("node:crypto");

const {
  query,
  withTransaction,
  mysqlTarget
} = require("../../lib/mysql");

const {
  createServiceServer,
  json,
  readJson,
  HttpError,
  requireInternal,
  listen
} = require("../../lib/http");

const { authenticate, authorize } = require("../../lib/security");

const PORT = Number(process.env.ORDERS_PORT || 4103);

let failures = 0;
let circuitUntil = 0;

function checkCircuit() {
  if (Date.now() < circuitUntil) {
    throw new HttpError(
      503,
      "El servicio de pedidos está temporalmente con alta demanda."
    );
  }

  if (circuitUntil && Date.now() >= circuitUntil) {
    circuitUntil = 0;
    failures = 0;
  }
}

function circuitSuccess() {
  failures = 0;
  circuitUntil = 0;
}

function circuitFailure(error) {
  if (error.status) return;

  if (++failures >= 5) {
    circuitUntil = Date.now() + 10000;
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    throw new HttpError(
      400,
      "El pedido debe incluir entre 1 y 50 productos."
    );
  }

  const map = new Map();

  for (const item of items) {
    const id = String(
      item.productoId || item.productId || item.id || ""
    );

    const quantity = Number(item.cantidad ?? item.quantity);

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(
        400,
        "El identificador de producto no es válido."
      );
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpError(
        400,
        "La cantidad debe ser un entero entre 1 y 100."
      );
    }

    map.set(id, (map.get(id) || 0) + quantity);
  }

  return [...map]
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function shape(order) {
  return {
    id: String(order.id),
    numero: String(order.id),
    estado: order.status,
    total: Number(order.total),
    createdAt: order.created_at,
    items: (order.items || []).map(item => ({
      productoId: String(item.product_id),
      nombre: item.name,
      cantidad: item.quantity,
      precioUnitarioHistorico: Number(item.unit_price)
    }))
  };
}

async function readOrders(where, values, limit) {
  const result = await query(
    `SELECT
      p.id,
      p.usuario_id,
      p.estado AS status,
      p.total,
      p.creado_en AS created_at,
      i.product_id,
      i.nombre AS name,
      i.cantidad AS quantity,
      i.precio_unitario AS unit_price
    FROM pedidos p
    LEFT JOIN pedido_items i ON i.pedido_id = p.id
    WHERE ${where}
    ORDER BY p.creado_en DESC
    LIMIT $${values.length + 1}`,
    [...values, limit]
  );

  const map = new Map();

  for (const row of result.rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        status: row.status,
        total: row.total,
        created_at: row.created_at,
        items: []
      });
    }

    if (row.product_id) {
      map.get(row.id).items.push(row);
    }
  }

  return [...map.values()].map(shape);
}

async function createOrder(req, user) {
  checkCircuit();

  const key = String(
    req.headers["idempotency-key"] || ""
  ).trim();

  if (key.length < 8 || key.length > 200) {
    throw new HttpError(
      400,
      "Falta una clave de idempotencia válida."
    );
  }

  const body = await readJson(req);
  const items = normalizeItems(body.items);

  const hash = createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex");

  try {
    const result = await withTransaction(async client => {
      const existingResult = await client.query(
        `SELECT request_hash, response
         FROM claves_idempotencia
         WHERE clave = $1 AND usuario_id = $2
         FOR UPDATE`,
        [key, user.sub]
      );

      const existing = existingResult.rows[0];

      if (existing) {
        if (existing.request_hash !== hash) {
          throw new HttpError(
            409,
            "La clave de idempotencia ya está asociada a otro pedido."
          );
        }

        if (existing.response) {
          const response = typeof existing.response === "string"
            ? JSON.parse(existing.response)
            : existing.response;

          return { status: 200, response };
        }
      } else {
        await client.query(
          `INSERT INTO claves_idempotencia
           (clave, usuario_id, request_hash)
           VALUES ($1, $2, $3)`,
          [key, user.sub, hash]
        );
      }

      const locked = [];
      let total = 0;

      for (const line of items) {
        const productResult = await client.query(
          `SELECT id, nombre, precio, stock
           FROM productos
           WHERE id = $1 AND activo = 1
           FOR UPDATE`,
          [line.id]
        );

        const row = productResult.rows[0];

        if (!row) {
          throw new HttpError(
            409,
            "Uno de los productos ya no está disponible."
          );
        }

        if (row.stock < line.quantity) {
          throw new HttpError(
            409,
            `Stock insuficiente para ${row.nombre}.`
          );
        }

        await client.query(
          `UPDATE productos
           SET stock = stock - $1, actualizado_en = NOW()
           WHERE id = $2`,
          [line.quantity, line.id]
        );

        const unit = Number(row.precio);
        const subtotal = unit * line.quantity;

        total += subtotal;

        locked.push({
          productId: row.id,
          name: row.nombre,
          quantity: line.quantity,
          unitPrice: unit,
          subtotal
        });
      }

      const orderId = randomUUID();

      await client.query(
        `INSERT INTO pedidos
         (id, usuario_id, estado, total)
         VALUES ($1, $2, 'confirmado', $3)`,
        [orderId, user.sub, total]
      );

      for (const item of locked) {
        await client.query(
          `INSERT INTO pedido_items
           (pedido_id, product_id, nombre, cantidad,
            precio_unitario, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            orderId,
            item.productId,
            item.name,
            item.quantity,
            item.unitPrice,
            item.subtotal
          ]
        );
      }

      const response = shape({
        id: orderId,
        status: "confirmado",
        total,
        created_at: new Date(),
        items: locked.map(item => ({
          product_id: item.productId,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unitPrice
        }))
      });

      await client.query(
        `UPDATE claves_idempotencia
         SET pedido_id = $1, response = $2
         WHERE clave = $3 AND usuario_id = $4`,
        [
          orderId,
          JSON.stringify(response),
          key,
          user.sub
        ]
      );

      return { status: 201, response };
    });

    circuitSuccess();
    return result;
  } catch (error) {
    circuitFailure(error);

    if (error.status) {
      throw error;
    }

    throw Object.assign(
      new HttpError(
        503,
        "No se pudo confirmar el pedido. Reintentá con la misma clave de idempotencia."
      ),
      { cause: error }
    );
  }
}

async function router(req, res) {
  const url = new URL(req.url, "http://orders.local");

  if (url.pathname === "/health") {
    await query("SELECT 1");

    return json(res, 200, {
      service: "orders",
      status: Date.now() < circuitUntil ? "degraded" : "ok",
      database: "mysql"
    });
  }

  if (url.pathname === "/" && req.method === "POST") {
    const user = authenticate(req);
    authorize(user, "client", "admin");

    const result = await createOrder(req, user);

    return json(res, result.status, result.response);
  }

  if (url.pathname === "/" && req.method === "GET") {
    const user = authenticate(req);

    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 50), 1),
      100
    );

    return json(res, 200, {
      items: await readOrders(
        "p.usuario_id = $1",
        [user.sub],
        limit
      )
    });
  }

  const route = url.pathname.match(
    /^\/([0-9a-f-]{36})$/i
  );

  if (route && req.method === "GET") {
    const user = authenticate(req);

    const rows = await readOrders(
      "p.id = $1 AND p.usuario_id = $2",
      [route[1], user.sub],
      1
    );

    if (!rows.length) {
      throw new HttpError(404, "Pedido no encontrado.");
    }

    return json(res, 200, rows[0]);
  }

  if (
    url.pathname === "/interno/administracion/pedidos" &&
    req.method === "GET"
  ) {
    requireInternal(req);

    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 100), 1),
      500
    );

    return json(res, 200, {
      items: await readOrders("TRUE", [], limit)
    });
  }

  return json(res, 404, {
    error: "NOT_FOUND",
    message: "Ruta de pedidos no encontrada."
  });
}

async function start() {
  await query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id CHAR(36) PRIMARY KEY,
      usuario_id VARCHAR(191) NOT NULL,
      estado VARCHAR(40) NOT NULL,
      total DECIMAL(12,2) NOT NULL,
      creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pedido_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      pedido_id CHAR(36) NOT NULL,
      product_id CHAR(36) NOT NULL,
      nombre VARCHAR(255) NOT NULL,
      cantidad INT NOT NULL,
      precio_unitario DECIMAL(12,2) NOT NULL,
      subtotal DECIMAL(12,2) NOT NULL,
      CONSTRAINT fk_pedido_items_pedido
        FOREIGN KEY (pedido_id)
        REFERENCES pedidos(id)
        ON DELETE CASCADE
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS claves_idempotencia (
      clave VARCHAR(200) NOT NULL,
      usuario_id VARCHAR(191) NOT NULL,
      request_hash CHAR(64) NOT NULL,
      pedido_id CHAR(36) NULL,
      response JSON NULL,
      creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (clave, usuario_id)
    )
  `);

  listen(
    createServiceServer(router),
    PORT,
    "Servicio de Pedidos"
  );
}

start().catch(error => {
  logError({
    service: "orders",
    stage: "startup_mysql",
    target: mysqlTarget()
  }, error);

  process.exit(1);
});
