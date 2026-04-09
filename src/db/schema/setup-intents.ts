import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const setupIntents = sqliteTable("setup_intents", {
  id: text("id").primaryKey(),
  customer_id: text("customer_id"),
  payment_method_id: text("payment_method_id"),
  status: text("status").notNull(),
  client_secret: text("client_secret").notNull(),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type SetupIntent = typeof setupIntents.$inferSelect;
export type NewSetupIntent = typeof setupIntents.$inferInsert;
