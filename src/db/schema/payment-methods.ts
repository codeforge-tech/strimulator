import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const paymentMethods = sqliteTable("payment_methods", {
  id: text("id").primaryKey(),
  customer_id: text("customer_id"),
  type: text("type").notNull(),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
