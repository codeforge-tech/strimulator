import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const paymentIntents = sqliteTable("payment_intents", {
  id: text("id").primaryKey(),
  customer_id: text("customer_id"),
  payment_method_id: text("payment_method_id"),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  client_secret: text("client_secret").notNull(),
  capture_method: text("capture_method").notNull().default("automatic"),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type NewPaymentIntent = typeof paymentIntents.$inferInsert;
