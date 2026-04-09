import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

export function createDB(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite);

  // Create tables directly
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  return db;
}

export type StrimulatorDB = ReturnType<typeof createDB>;
