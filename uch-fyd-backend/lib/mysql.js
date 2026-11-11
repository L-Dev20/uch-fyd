
const mysql = require("mysql2/promise");
const { logError } = require("./diagnostics");

const config = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE || "uchfyd",
  user: process.env.MYSQL_USER || "uchfyd",
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 20),
  connectTimeout: 5000,
  decimalNumbers: true
};

const pool = mysql.createPool(config);

function mysqlTarget() {
  return {
    host: config.host,
    port: String(config.port),
    database: config.database,
    user: config.user
  };
}

function prepare(text, values = []) {
  const ordered = [];

  const sql = text
    .replace(/\$(\d+)/g, (_, number) => {
      ordered.push(values[Number(number) - 1]);
      return "?";
    })
    .replace(/\bILIKE\b/gi, "LIKE");

  return {
    sql,
    values: ordered.length ? ordered : values
  };
}

async function execute(connection, text, values = []) {
  const statement = prepare(text, values);
  const [result] = await connection.execute(
    statement.sql,
    statement.values
  );

  return {
    rows: Array.isArray(result) ? result : [],
    result
  };
}

async function query(text, values = []) {
  try {
    return await execute(pool, text, values);
  } catch (error) {
    logError({
      service: process.env.SERVICE_NAME || "mysql-client",
      stage: "mysql_query",
      target: mysqlTarget(),
      query: text.replace(/\s+/g, " ").slice(0, 180)
    }, error);

    throw error;
  }
}

async function withTransaction(work) {
  let connection;

  try {
    connection = await pool.getConnection();
  } catch (error) {
    logError({
      service: process.env.SERVICE_NAME || "mysql-client",
      stage: "mysql_connect",
      target: mysqlTarget()
    }, error);

    throw error;
  }

  try {
    await connection.beginTransaction();

    const result = await work({
      query: (text, values = []) =>
        execute(connection, text, values)
    });

    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

    throw error;
  } finally {
    connection.release();
  }
}

pool.on("error", error => {
  logError({
    service: process.env.SERVICE_NAME || "mysql-client",
    stage: "mysql_pool_error",
    target: mysqlTarget()
  }, error);
});

module.exports = {
  pool,
  query,
  withTransaction,
  mysqlTarget
};
