const fs = require("node:fs");
const path = require("node:path");
const file = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key.startsWith("POSTGRES_")) process.env[key] = value;
    else if (process.env[key] === undefined) process.env[key] = value;
  }
  // Local development uses the split PostgreSQL settings from .env. Ignore a
  // stale POSTGRES_URL inherited from a previous shell or user-level variable.
  if (process.env.POSTGRES_HOST && process.env.POSTGRES_PASSWORD) delete process.env.POSTGRES_URL;
}
