require("./load-env");
const { pool, postgresTarget } = require("../lib/postgres");
const { logError } = require("../lib/diagnostics");
(async () => {
  const target = postgresTarget();
  console.log(`Probando PostgreSQL en ${target.user}@${target.host}:${target.port}/${target.database}`);
  const result = await pool.query("SELECT current_user, current_database(), inet_server_addr() AS server_address, inet_server_port() AS server_port");
  console.log(JSON.stringify(result.rows[0], null, 2));
  await pool.end();
})().catch(async error => { logError({ service: "db-check", stage: "postgres_connectivity_check", target: postgresTarget() }, error); await pool.end().catch(() => {}); process.exit(1); });
