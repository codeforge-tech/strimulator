import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  apiPath: text("api_path").notNull(),
  method: text("method").notNull(),
  responseCode: integer("response_code").notNull(),
  responseBody: text("response_body").notNull(),
  created: integer("created").notNull(),
});

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
