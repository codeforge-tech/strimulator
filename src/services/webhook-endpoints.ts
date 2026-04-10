import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { webhookEndpoints } from "../db/schema/webhook-endpoints";
import { generateId, generateSecret } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, cursorCondition, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";

export interface CreateWebhookEndpointParams {
  url: string;
  enabled_events: string[];
  description?: string;
  metadata?: Record<string, string>;
}

export interface UpdateWebhookEndpointParams {
  url?: string;
  enabled_events?: string[];
  status?: string;
}

function buildEndpointShape(
  id: string,
  createdAt: number,
  secret: string,
  params: CreateWebhookEndpointParams,
): Stripe.WebhookEndpoint {
  return {
    id,
    object: "webhook_endpoint",
    api_version: null,
    application: null,
    created: createdAt,
    description: params.description ?? null,
    enabled_events: params.enabled_events,
    livemode: false,
    metadata: params.metadata ?? {},
    secret,
    status: "enabled",
    url: params.url,
  } as unknown as Stripe.WebhookEndpoint;
}

export class WebhookEndpointService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreateWebhookEndpointParams): Stripe.WebhookEndpoint {
    if (!params.url) {
      throw invalidRequestError("Missing required param: url.", "url");
    }
    if (!params.enabled_events || params.enabled_events.length === 0) {
      throw invalidRequestError("Missing required param: enabled_events.", "enabled_events");
    }

    const id = generateId("webhook_endpoint");
    const createdAt = now();
    const secret = generateSecret("whsec");
    const endpoint = buildEndpointShape(id, createdAt, secret, params);

    this.db.insert(webhookEndpoints).values({
      id,
      url: params.url,
      secret,
      status: "enabled",
      enabledEvents: JSON.stringify(params.enabled_events),
      created: createdAt,
      data: JSON.stringify(endpoint),
    }).run();

    return endpoint;
  }

  retrieve(id: string): Stripe.WebhookEndpoint {
    const row = this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("webhook_endpoint", id);
    }

    return JSON.parse(row.data as string) as Stripe.WebhookEndpoint;
  }

  update(id: string, params: UpdateWebhookEndpointParams): Stripe.WebhookEndpoint {
    const existing = this.retrieve(id);

    const updated: Record<string, unknown> = { ...existing };
    const dbUpdates: Record<string, unknown> = {};

    if (params.url !== undefined) {
      updated.url = params.url;
      dbUpdates.url = params.url;
    }
    if (params.enabled_events !== undefined) {
      updated.enabled_events = params.enabled_events;
      dbUpdates.enabledEvents = JSON.stringify(params.enabled_events);
    }
    if (params.status !== undefined) {
      updated.status = params.status;
      dbUpdates.status = params.status;
    }

    dbUpdates.data = JSON.stringify(updated);

    this.db.update(webhookEndpoints)
      .set(dbUpdates)
      .where(eq(webhookEndpoints.id, id))
      .run();

    return updated as unknown as Stripe.WebhookEndpoint;
  }

  del(id: string): Stripe.DeletedWebhookEndpoint {
    // Ensure it exists first
    this.retrieve(id);

    this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).run();

    return {
      id,
      object: "webhook_endpoint",
      deleted: true,
    } as Stripe.DeletedWebhookEndpoint;
  }

  listAll(): Array<{ id: string; url: string; secret: string; status: string; enabledEvents: string[] }> {
    const rows = this.db.select().from(webhookEndpoints).all();
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      secret: r.secret,
      status: r.status,
      enabledEvents: JSON.parse(r.enabledEvents as string) as string[],
    }));
  }

  list(params: ListParams): ListResponse<Stripe.WebhookEndpoint> {
    const { limit, startingAfter } = params;
    const fetchLimit = limit + 1;

    let rows;
    if (startingAfter) {
      const cursor = this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("webhook_endpoint", startingAfter);
      }
      rows = this.db.select().from(webhookEndpoints)
        .where(cursorCondition(webhookEndpoints.created, webhookEndpoints.id, cursor.created, cursor.id))
        .orderBy(webhookEndpoints.created, webhookEndpoints.id).limit(fetchLimit).all();
    } else {
      rows = this.db.select().from(webhookEndpoints).orderBy(webhookEndpoints.created, webhookEndpoints.id).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data as string) as Stripe.WebhookEndpoint);

    return buildListResponse(items, "/v1/webhook_endpoints", hasMore);
  }
}
