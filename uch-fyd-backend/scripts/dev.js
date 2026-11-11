const { spawn } = require("node:child_process");
require("./load-env");
const services = [
  ["identity-admin", "services/identity-admin/server.js"],
  ["catalog", "services/catalog/server.js"],
  ["orders", "services/orders/server.js"],
  ["gateway", "services/gateway/server.js"]
];
const children = services.map(([name, file]) => {
  const child = spawn(process.execPath, [file], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (!shuttingDown && (code || signal)) {
      console.error(`[${name}] terminó inesperadamente (${signal || `código ${code}`}).`);
      shutdown(code || 1);
    }
  });
  return child;
});
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(code), 250);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
console.log("UCH-FyD backend iniciado: Identity/Admin 4101, Catalog 4102, Orders 4103, Gateway 4100");
