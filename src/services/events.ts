import type Stripe from "stripe";
import { eq, desc, and, lt, or } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { events } from "../db/schema/events";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError } from "../errors";
import { config } from "../config";

export interface ListEventParams {
  type?: string;
  limit: number;
  startingAfter?: string;
}

export type EventListener = (event: Stripe.Event) => void;

function buildEventShape(
  id: string,
  createdAt: number,
  type: string,
  object: Record<string, unknown>,
  previousAttributes?: Record<string, unknown>,
): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: config.apiVersion,
    created: createdAt,
    data: {
      object,
      ...(previousAttributes !== undefined ? { previous_attributes: previousAttributes } : {}),
    },
    livemode: false,
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  } as unknown as Stripe.Event;
}

export class EventService {
  private listeners: EventListener[] = [];

  constructor(private db: StrimulatorDB) {}

  onEvent(listener: EventListener): void {
    this.listeners.push(listener);
  }

  emit(
    type: string,
    object: Record<string, unknown>,
    previousAttributes?: Record<string, unknown>,
  ): Stripe.Event {
    const id = generateId("event");
    const createdAt = now();
    const event = buildEventShape(id, createdAt, type, object, previousAttributes);

    this.db.insert(events).values({
      id,
      type,
      apiVersion: config.apiVersion,
      created: createdAt,
      data: JSON.stringify(event),
    }).run();

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }

    return event;
  }

  retrieve(id: string): Stripe.Event {
    const row = this.db.select().from(events).where(eq(events.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("event", id);
    }

    return JSON.parse(row.data as string) as Stripe.Event;
  }

  list(params: ListEventParams): ListResponse<Stripe.Event> {
    const { limit, type, startingAfter } = params;
    const fetchLimit = limit + 1;

    const buildConditions = (extraCondition?: ReturnType<typeof eq>) => {
      const conditions = [];
      if (type) conditions.push(eq(events.type, type));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...conditions) : undefined;
    };

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(events).where(eq(events.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("event", startingAfter);
      }

      // Desc ordering: "after" means older items (created < cursor.created),
      // with id tiebreaker for same-second items
      const cc = or(
        lt(events.created, cursor.created),
        and(eq(events.created, cursor.created), lt(events.id, cursor.id)),
      )!;
      const condition = buildConditions(cc);
      rows = this.db.select()
        .from(events)
        .where(condition)
        .orderBy(desc(events.created), desc(events.id))
        .limit(fetchLimit)
        .all();
    } else {
      const condition = buildConditions();
      if (condition) {
        rows = this.db.select()
          .from(events)
          .where(condition)
          .orderBy(desc(events.created), desc(events.id))
          .limit(fetchLimit)
          .all();
      } else {
        rows = this.db.select()
          .from(events)
          .orderBy(desc(events.created), desc(events.id))
          .limit(fetchLimit)
          .all();
      }
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data as string) as Stripe.Event);

    return buildListResponse(items, "/v1/events", hasMore);
  }
}
