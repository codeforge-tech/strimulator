import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  deleted: integer("deleted").notNull().default(0),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
