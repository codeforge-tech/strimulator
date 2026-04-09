import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  charge_id: text("charge_id").notNull(),
  payment_intent_id: text("payment_intent_id"),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
