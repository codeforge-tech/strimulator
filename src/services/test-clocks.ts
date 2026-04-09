import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { testClocks } from "../db/schema/test-clocks";
import { subscriptions, subscriptionItems } from "../db/schema/subscriptions";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type { EventService } from "./events";
import type { InvoiceService } from "./invoices";
import { actionFlags } from "../lib/action-flags";

export interface CreateTestClockParams {
  frozen_time: number;
  name?: string;
}

// 30 days after creation in seconds
const DELETES_AFTER_SECONDS = 30 * 24 * 60 * 60;

function buildTestClockShape(
  id: string,
  createdAt: number,
  frozenTime: number,
  name?: string,
): Stripe.TestHelpers.TestClock {
  return {
    id,
    object: "test_helpers.test_clock",
    created: createdAt,
    deletes_after: createdAt + DELETES_AFTER_SECONDS,
    frozen_time: frozenTime,
    livemode: false,
    name: name ?? null,
    status: "ready",
  } as unknown as Stripe.TestHelpers.TestClock;
}

export class TestClockService {
  constructor(
    private db: StrimulatorDB,
    private eventService?: EventService,
    private invoiceService?: InvoiceService,
  ) {}

  create(params: CreateTestClockParams): Stripe.TestHelpers.TestClock {
    const id = generateId("test_clock");
    const createdAt = now();
    const clock = buildTestClockShape(id, createdAt, params.frozen_time, params.name);

    this.db.insert(testClocks).values({
      id,
      frozenTime: params.frozen_time,
      status: "ready",
      name: params.name ?? null,
      created: createdAt,
      data: JSON.stringify(clock),
    }).run();

    return clock;
  }

  retrieve(id: string): Stripe.TestHelpers.TestClock {
    const row = this.db.select().from(testClocks).where(eq(testClocks.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("test_clock", id);
    }

    return JSON.parse(row.data as string) as Stripe.TestHelpers.TestClock;
  }

  del(id: string): any {
    // Ensure it exists first
    this.retrieve(id);

    this.db.delete(testClocks).where(eq(testClocks.id, id)).run();

    return {
      id,
      object: "test_helpers.test_clock",
      deleted: true,
    };
  }

  advance(id: string, frozenTime: number): Stripe.TestHelpers.TestClock {
    const existing = this.retrieve(id);
    const currentFrozenTime = (existing as unknown as { frozen_time: number }).frozen_time;

    if (frozenTime <= currentFrozenTime) {
      throw invalidRequestError(
        "The frozen_time must be after the current frozen_time of the test clock.",
        "frozen_time",
      );
    }

    // Set status to advancing
    const advancing = {
      ...existing,
      frozen_time: frozenTime,
      status: "advancing",
    } as unknown as Stripe.TestHelpers.TestClock;

    this.db.update(testClocks)
      .set({
        frozenTime,
        status: "advancing",
        data: JSON.stringify(advancing),
      })
      .where(eq(testClocks.id, id))
      .run();

    // Process billing for linked subscriptions
    this.processBillingCycles(id, frozenTime);

    // Set status back to ready
    const ready = {
      ...advancing,
      status: "ready",
    } as unknown as Stripe.TestHelpers.TestClock;

    this.db.update(testClocks)
      .set({
        status: "ready",
        data: JSON.stringify(ready),
      })
      .where(eq(testClocks.id, id))
      .run();

    return ready;
  }

  private processBillingCycles(clockId: string, frozenTime: number): void {
    if (!this.eventService || !this.invoiceService) return;

    const THIRTY_DAYS = 30 * 24 * 60 * 60;

    // Find all subscriptions linked to this clock
    const subRows = this.db.select().from(subscriptions)
      .where(eq(subscriptions.testClockId, clockId))
      .all();

    for (const subRow of subRows) {
      const sub = JSON.parse(subRow.data as string) as any;
      if (sub.status !== "active" && sub.status !== "trialing") continue;

      let currentStatus = sub.status as string;
      let periodStart = subRow.currentPeriodStart;
      let periodEnd = subRow.currentPeriodEnd;
      let trialEnd = sub.trial_end as number | null;

      // End trial if needed
      if (currentStatus === "trialing" && trialEnd && frozenTime >= trialEnd) {
        const prevStatus = currentStatus;
        currentStatus = "active";

        const updatedSub = { ...sub, status: "active" };
        this.db.update(subscriptions)
          .set({ status: "active", data: JSON.stringify(updatedSub) })
          .where(eq(subscriptions.id, sub.id))
          .run();

        this.eventService.emit(
          "customer.subscription.updated",
          updatedSub,
          { status: prevStatus, trial_end: trialEnd },
        );

        Object.assign(sub, updatedSub);
      }

      // Calculate amount from subscription items (invariant across period rolls)
      const itemRows = this.db.select().from(subscriptionItems)
        .where(eq(subscriptionItems.subscriptionId, sub.id))
        .all();

      let totalAmount = 0;
      for (const itemRow of itemRows) {
        const item = JSON.parse(itemRow.data as string) as any;
        const priceAmount = item.price?.unit_amount ?? 0;
        const quantity = itemRow.quantity ?? 1;
        totalAmount += priceAmount * quantity;
      }

      // Roll periods
      while (frozenTime >= periodEnd && currentStatus === "active") {
        const prevPeriodStart = periodStart;
        const prevPeriodEnd = periodEnd;
        periodStart = periodEnd;
        periodEnd = periodStart + THIRTY_DAYS;

        // Update subscription period
        const rolledSub = {
          ...sub,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          status: currentStatus,
        };

        this.db.update(subscriptions)
          .set({
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            status: currentStatus,
            data: JSON.stringify(rolledSub),
          })
          .where(eq(subscriptions.id, sub.id))
          .run();

        this.eventService.emit(
          "customer.subscription.updated",
          rolledSub,
          { current_period_start: prevPeriodStart, current_period_end: prevPeriodEnd },
        );

        // Create invoice
        const invoice = this.invoiceService.create({
          customer: sub.customer as string,
          subscription: sub.id,
          currency: sub.currency,
          amount_due: totalAmount,
          billing_reason: "subscription_cycle",
        });

        // Finalize
        this.invoiceService.finalizeInvoice(invoice.id);

        // Auto-pay (unless failNextPayment flag is set)
        if (actionFlags.failNextPayment) {
          actionFlags.failNextPayment = null;
          const pastDueSub = { ...rolledSub, status: "past_due" };
          this.db.update(subscriptions)
            .set({ status: "past_due", data: JSON.stringify(pastDueSub) })
            .where(eq(subscriptions.id, sub.id))
            .run();

          this.eventService.emit(
            "customer.subscription.updated",
            pastDueSub,
            { status: "active" },
          );

          currentStatus = "past_due";
        } else {
          this.invoiceService.pay(invoice.id);
        }

        Object.assign(sub, rolledSub);
      }
    }
  }

  list(params: ListParams): ListResponse<Stripe.TestHelpers.TestClock> {
    const { limit, startingAfter } = params;
    const fetchLimit = limit + 1;

    let rows;
    if (startingAfter) {
      const cursor = this.db.select().from(testClocks).where(eq(testClocks.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("test_clock", startingAfter);
      }
      rows = this.db.select().from(testClocks).limit(fetchLimit).all();
    } else {
      rows = this.db.select().from(testClocks).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data as string) as Stripe.TestHelpers.TestClock);

    return buildListResponse(items, "/v1/test_helpers/test_clocks", hasMore);
  }
}
