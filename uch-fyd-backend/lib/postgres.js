
const { Pool } = require("pg");
const { logError } = require("./diagnostics");

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
  if (!connectionString) {
    return {
      host: localConfig.host,
      port: String(localConfig.port),
      database: localConfig.database,
      user: localConfig.user
    };
  }

  try {
    const url = new URL(connectionString);

    return {
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, ""),
      user: decodeURIComponent(url.username)
    };
  } catch {
    return {
      host: "configuración inválida",
      port: "?",
      database: "?",
      user: "?"
    };
  }
}

pool.on("error", error => logError({
  service: process.env.SERVICE_NAME || "postgres-client",
  stage: "postgres_pool_error",
  target: postgresTarget()
}, error));

async function query(text, values) {
  try {
    return await pool.query(text, values);
  } catch (error) {
    logError({
      service: process.env.SERVICE_NAME || "postgres-client",
      stage: "postgres_query",
      target: postgresTarget(),
      query: text.replace(/\s+/g, " ").slice(0, 180)
    }, error);

    throw error;
  }
}

async function withTransaction(work) {
  let client;

  try {
    client = await pool.connect();
  } catch (error) {
    logError({
      service: process.env.SERVICE_NAME || "postgres-client",
      stage: "postgres_connect",
      target: postgresTarget()
    }, error);

    throw error;
  }

  try {
    await client.query("BEGIN");

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
  postgresTarget
};
