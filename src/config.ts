export const config = {
  port: parseInt(process.env.STRIMULATOR_PORT ?? "12111", 10),
  dbPath: process.env.STRIMULATOR_DB_PATH ?? ":memory:",
  logLevel: process.env.STRIMULATOR_LOG_LEVEL ?? "info",
  apiVersion: process.env.STRIMULATOR_API_VERSION ?? "2024-12-18",
} as const;
