function rootCause(error) {
  let current = error;
  const chain = [];
  const seen = new Set();
  while (current && !seen.has(current) && chain.length < 5) {
    seen.add(current);
    chain.push({
      name: current.name || "Error",
      code: current.code,
      message: current.message,
      syscall: current.syscall,
      address: current.address,
      port: current.port
    });
    current = current.cause;
  }
  return chain;
}

function errorDetails(error, context = {}) {
  return {
    event: "service_error",
    at: new Date().toISOString(),
    ...context,
    error: {
      name: error?.name || "Error",
      code: error?.code,
      message: error?.message || "Error sin mensaje",
      stack: error?.stack
    },
    causes: rootCause(error)
  };
}

function logError(context, error) {
  // Never include request bodies, authorization headers, passwords or database URIs here.
  console.error(JSON.stringify(errorDetails(error, context)));
}

function installProcessDiagnostics(service) {
  process.on("unhandledRejection", reason => logError({ service, stage: "unhandled_rejection" }, reason));
  process.on("uncaughtException", error => {
    logError({ service, stage: "uncaught_exception" }, error);
    process.exit(1);
  });
}

module.exports = { errorDetails, logError, installProcessDiagnostics };
