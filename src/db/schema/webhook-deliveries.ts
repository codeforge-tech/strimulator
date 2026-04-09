import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  endpointId: text("endpoint_id").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: integer("next_retry_at"),
  created: integer("created").notNull(),
});

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
