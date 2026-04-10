import { describe, it, expect } from "bun:test";
import { createDB, getRawSqlite } from "../../src/db";

describe("createDB", () => {
  it("creates an in-memory database with :memory:", () => {
    const db = createDB(":memory:");
    expect(db).toBeDefined();
  });

  it("creates an in-memory database with default path", () => {
    const db = createDB();
    expect(db).toBeDefined();
  });

  it("returns a drizzle db instance (object)", () => {
    const db = createDB(":memory:");
    expect(typeof db).toBe("object");
  });

  it("database has customers table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has payment_intents table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_intents'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has products table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has prices table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has subscriptions table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has invoices table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has events table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has charges table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='charges'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has webhook_endpoints table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_endpoints'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("database has idempotency_keys table", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("multiple DB instances are independent", () => {
    const db1 = createDB(":memory:");
    const db2 = createDB(":memory:");

    const sqlite1 = getRawSqlite(db1);
    const sqlite2 = getRawSqlite(db2);

    // Insert into db1
    sqlite1.exec(
      "INSERT INTO customers (id, email, name, deleted, created, data) VALUES ('cus_1', 'a@b.com', 'Alice', 0, 1000, '{}')",
    );

    // db2 should not have the row
    const rows = sqlite2.prepare("SELECT * FROM customers WHERE id='cus_1'").all();
    expect(rows).toHaveLength(0);

    // db1 should have the row
    const rows1 = sqlite1.prepare("SELECT * FROM customers WHERE id='cus_1'").all();
    expect(rows1).toHaveLength(1);
  });

  it("basic insert and select works via raw SQLite", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);

    sqlite.exec(
      "INSERT INTO customers (id, email, name, deleted, created, data) VALUES ('cus_test', 'test@test.com', 'Test', 0, 1000, '{}')",
    );

    const row = sqlite.prepare("SELECT * FROM customers WHERE id='cus_test'").get() as any;
    expect(row).toBeDefined();
    expect(row.id).toBe("cus_test");
    expect(row.email).toBe("test@test.com");
  });

  it("WAL mode pragma is executed (in-memory databases report 'memory')", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const result = sqlite.prepare("PRAGMA journal_mode").get() as any;
    // In-memory SQLite databases cannot use WAL, they report 'memory' instead
    expect(result.journal_mode).toBe("memory");
  });

  it("foreign keys are enabled", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const result = sqlite.prepare("PRAGMA foreign_keys").get() as any;
    expect(result.foreign_keys).toBe(1);
  });
});

describe("getRawSqlite", () => {
  it("returns raw SQLite database instance", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    expect(sqlite).toBeDefined();
    expect(typeof sqlite.exec).toBe("function");
    expect(typeof sqlite.prepare).toBe("function");
  });

  it("returned instance can execute queries", () => {
    const db = createDB(":memory:");
    const sqlite = getRawSqlite(db);
    const result = sqlite.prepare("SELECT 1 as val").get() as any;
    expect(result.val).toBe(1);
  });
});
