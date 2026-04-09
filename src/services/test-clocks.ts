import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { testClocks } from "../db/schema/test-clocks";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";

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
  constructor(private db: StrimulatorDB) {}

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

    const updated = {
      ...existing,
      frozen_time: frozenTime,
    } as unknown as Stripe.TestHelpers.TestClock;

    this.db.update(testClocks)
      .set({
        frozenTime,
        data: JSON.stringify(updated),
      })
      .where(eq(testClocks.id, id))
      .run();

    return updated;
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
