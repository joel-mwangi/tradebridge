function safeContext(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) =>
      !/(token|secret|password|cookie|authorization|account_id|contract_id)/i.test(key)
      && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null),
    ),
  );
}

function errorDetails(error) {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 500) };
  }
  return { message: String(error).slice(0, 500) };
}

function write(level, event, fields, error) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    context: safeContext(fields),
    ...(errorDetails(error) ? { error: errorDetails(error) } : {}),
  };
  console[level](JSON.stringify(record));
}

export const logger = {
  error(event, fields, error) {
    write("error", event, fields, error);
  },
  warn(event, fields, error) {
    write("warn", event, fields, error);
  },
};