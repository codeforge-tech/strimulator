import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const webhookEndpoints = sqliteTable("webhook_endpoints", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  status: text("status").notNull().default("enabled"),
  enabledEvents: text("enabled_events", { mode: "json" }).notNull(),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
