import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  status: text("status").notNull(),
  currentPeriodStart: integer("current_period_start").notNull(),
  currentPeriodEnd: integer("current_period_end").notNull(),
  testClockId: text("test_clock_id"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});

export const subscriptionItems = sqliteTable("subscription_items", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull(),
  priceId: text("price_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
