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

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS prices (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      unit_amount INTEGER,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      type TEXT NOT NULL,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      payment_method_id TEXT,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      capture_method TEXT NOT NULL DEFAULT 'automatic',
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS charges (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      payment_intent_id TEXT,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      refunded_amount INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      charge_id TEXT NOT NULL,
      payment_intent_id TEXT,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS setup_intents (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      payment_method_id TEXT,
      status TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  return db;
}

export type StrimulatorDB = ReturnType<typeof createDB>;
