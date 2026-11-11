
require("./scripts/load-env");

const password = process.env.POSTGRES_PASSWORD;

console.log({
  passwordLoaded: Boolean(password),
  length: password?.length,
  matchesExpected: password === "TuPasswordSeguro123"
});
