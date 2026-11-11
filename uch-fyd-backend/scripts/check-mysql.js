require("./load-env");
const { pool, query, mysqlTarget } = require("../lib/mysql");
const { logError } = require("../lib/diagnostics");
(async () => {
  const target = mysqlTarget();
  console.log(`Probando MySQL en ${target.user}@${target.host}:${target.port}/${target.database}`);
  const result = await query("SELECT CURRENT_USER() AS user, DATABASE() AS database_name");
  console.log("Conexión MySQL exitosa:", result.rows[0]);
  await pool.end();
})().catch(async error => { logError({ service: "db-check", stage: "mysql_connectivity_check", target: mysqlTarget() }, error); await pool.end().catch(() => {}); process.exit(1); });
