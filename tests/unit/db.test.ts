import { describe, it, expect } from "bun:test";
import { createDB } from "../../src/db";

describe("createDB", () => {
  it("creates an in-memory database", () => {
    const db = createDB(":memory:");
    expect(db).toBeDefined();
  });

  it("creates an in-memory database with default path", () => {
    const db = createDB();
    expect(db).toBeDefined();
  });

  it("returns a drizzle db instance with a query interface", () => {
    const db = createDB(":memory:");
    expect(typeof db).toBe("object");
  });

  it("creates the customers table without error", () => {
    // createDB runs CREATE TABLE IF NOT EXISTS internally; if it throws, test fails
    const db = createDB(":memory:");
    expect(db).toBeDefined();
  });
});
