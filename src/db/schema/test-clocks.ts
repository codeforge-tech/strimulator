import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const testClocks = sqliteTable("test_clocks", {
  id: text("id").primaryKey(),
  frozenTime: integer("frozen_time").notNull(),
  status: text("status").notNull().default("ready"),
  name: text("name"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});

export type TestClock = typeof testClocks.$inferSelect;
export type NewTestClock = typeof testClocks.$inferInsert;
