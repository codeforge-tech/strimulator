import type Stripe from "stripe";
import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { webhookDeliveries } from "../db/schema/webhook-deliveries";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import type { WebhookEndpointService } from "./webhook-endpoints";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 10000, 60000]; // 1s, 10s, 60s

export class WebhookDeliveryService {
  constructor(
    private db: StrimulatorDB,
    private endpointService: WebhookEndpointService,
  ) {}

  findMatchingEndpoints(
    eventType: string,
  ): Array<{ id: string; url: string; secret: string }> {
    const allEndpoints = this.endpointService.listAll();

    return allEndpoints
      .filter((ep) => ep.status === "enabled")
      .filter((ep) =>
        ep.enabledEvents.includes("*") || ep.enabledEvents.includes(eventType),
      )
      .map((ep) => ({ id: ep.id, url: ep.url, secret: ep.secret }));
  }

  generateSignature(payload: string, secret: string, timestamp: number): string {
    // Strip the "whsec_" prefix from the secret if present
    const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    const signedPayload = `${timestamp}.${payload}`;
    const hmac = createHmac("sha256", rawSecret).update(signedPayload).digest("hex");
    return `t=${timestamp},v1=${hmac}`;
  }

  async deliver(event: Stripe.Event): Promise<void> {
    const matchingEndpoints = this.findMatchingEndpoints(event.type);

    for (const endpoint of matchingEndpoints) {
      const deliveryId = generateId("webhook_delivery");
      const createdAt = now();

      this.db.insert(webhookDeliveries).values({
        id: deliveryId,
        eventId: event.id,
        endpointId: endpoint.id,
        status: "pending",
        attempts: 0,
        nextRetryAt: null,
        created: createdAt,
      }).run();

      // Attempt delivery asynchronously
      this.attemptDelivery(deliveryId, endpoint, event, 0);
    }
  }

  private async attemptDelivery(
    deliveryId: string,
    endpoint: { id: string; url: string; secret: string },
    event: Stripe.Event,
    attemptNumber: number,
  ): Promise<void> {
    const payload = JSON.stringify(event);
    const timestamp = now();
    const signature = this.generateSignature(payload, endpoint.secret, timestamp);

    let success = false;
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": signature,
          "User-Agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
        },
        body: payload,
      });

      success = response.status >= 200 && response.status < 300;
    } catch {
      success = false;
    }

    const newAttempts = attemptNumber + 1;

    if (success) {
      this.db.update(webhookDeliveries)
        .set({ status: "delivered", attempts: newAttempts })
        .where(eq(webhookDeliveries.id, deliveryId))
        .run();
    } else if (newAttempts < MAX_ATTEMPTS) {
      const retryDelayMs = RETRY_DELAYS_MS[newAttempts] ?? 60000;
      const nextRetryAt = now() + Math.floor(retryDelayMs / 1000);

      this.db.update(webhookDeliveries)
        .set({ status: "pending", attempts: newAttempts, nextRetryAt })
        .where(eq(webhookDeliveries.id, deliveryId))
        .run();

      setTimeout(() => {
        this.attemptDelivery(deliveryId, endpoint, event, newAttempts);
      }, retryDelayMs);
    } else {
      this.db.update(webhookDeliveries)
        .set({ status: "failed", attempts: newAttempts })
        .where(eq(webhookDeliveries.id, deliveryId))
        .run();
    }
  }
}
