import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

export function createDB(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite);

  // Run Drizzle migrations
  migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });

  // Attach the raw sqlite instance for dashboard raw SQL access
  (db as any).__sqlite = sqlite;

  return db;
}

export type StrimulatorDB = ReturnType<typeof createDB>;

export function getRawSqlite(db: StrimulatorDB): import("bun:sqlite").Database {
  return (db as any).__sqlite;
}
