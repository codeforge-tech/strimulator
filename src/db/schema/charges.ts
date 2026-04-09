import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const charges = sqliteTable("charges", {
  id: text("id").primaryKey(),
  customer_id: text("customer_id"),
  payment_intent_id: text("payment_intent_id"),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  refunded_amount: integer("refunded_amount").notNull().default(0),
  created: integer("created").notNull(),
  data: text("data").notNull(),
});

export type Charge = typeof charges.$inferSelect;
export type NewCharge = typeof charges.$inferInsert;
