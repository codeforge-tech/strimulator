import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  subscriptionId: text("subscription_id"),
  status: text("status").notNull(),
  amountDue: integer("amount_due").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  currency: text("currency").notNull(),
  paymentIntentId: text("payment_intent_id"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
