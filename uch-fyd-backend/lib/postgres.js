const { Pool } = require("pg");

const connectionString = process.env.POSTGRES_URL?.trim();
const localConfig = {
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "uchfyd",
  user: process.env.POSTGRES_USER || "uchfyd",
  password: process.env.POSTGRES_PASSWORD
};
const pool = new Pool({
  ...(connectionString ? { connectionString } : localConfig),
  max: Number(process.env.POSTGRES_POOL_SIZE || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

function postgresTarget() {
  if (!connectionString) return { host: localConfig.host, port: String(localConfig.port), database: localConfig.database, user: localConfig.user };
  try {
    const url = new URL(connectionString);
    return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, ""), user: decodeURIComponent(url.username) };
  } catch { return { host: "configuración inválida", port: "?", database: "?", user: "?" }; }
}

pool.on("error", error => console.error(`[postgres] Error de conexión (${postgresTarget().host}:${postgresTarget().port}/${postgresTarget().database}): ${error.message}`));

async function query(text, values) { return pool.query(text, values); }
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
module.exports = { pool, query, withTransaction, postgresTarget };
