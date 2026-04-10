import { gt, eq, and, or } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

export interface ListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}

/**
 * Build a composite cursor condition for keyset pagination.
 * Handles same-second tiebreaking by using (created, id) instead of just created.
 * Returns: (created > cursor.created) OR (created = cursor.created AND id > cursor.id)
 */
export function cursorCondition(
  createdCol: SQLiteColumn,
  idCol: SQLiteColumn,
  cursorCreated: number,
  cursorId: string,
) {
  return or(
    gt(createdCol, cursorCreated),
    and(eq(createdCol, cursorCreated), gt(idCol, cursorId)),
  )!;
}

export function buildListResponse<T>(items: T[], url: string, hasMore: boolean): ListResponse<T> {
  return { object: "list", data: items, has_more: hasMore, url };
}

export interface ListParams {
  limit: number;
  startingAfter: string | undefined;
  endingBefore: string | undefined;
}

export function parseListParams(query: Record<string, string | undefined>): ListParams {
  let limit = parseInt(query.limit ?? "10", 10);
  if (isNaN(limit) || limit < 1) limit = 1;
  if (limit > 100) limit = 100;
  return {
    limit,
    startingAfter: query.starting_after ?? undefined,
    endingBefore: query.ending_before ?? undefined,
  };
}
