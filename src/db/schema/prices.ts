import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const prices = sqliteTable("prices", {
  id: text("id").primaryKey(),
  product_id: text("product_id").notNull(),
  active: integer("active").notNull().default(1),
  type: text("type").notNull(),
  currency: text("currency").notNull(),
  unit_amount: integer("unit_amount"),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type Price = typeof prices.$inferSelect;
export type NewPrice = typeof prices.$inferInsert;
