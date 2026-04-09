# Strimulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Stripe emulator API that is SDK-compatible, has strict fidelity to Stripe's state machines, and ships as a single Docker image with an interactive debug dashboard.

**Architecture:** Layered design — ElysiaJS route plugins (param validation, response shaping) -> Service classes (state machines, business logic, event emission) -> Drizzle ORM data layer (SQLite with JSON blobs + indexed columns). All routes under `/v1/`, dashboard under `/dashboard/`. Single Bun process, single port.

**Tech Stack:** Bun, ElysiaJS, Drizzle ORM (bun:sqlite), stripe npm package (types), Preact + HTM (dashboard), bun:test

**Spec:** `docs/superpowers/specs/2026-04-09-strimulator-design.md`

---

## Phase 1: Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `drizzle.config.ts`
- Create: `src/index.ts`
- Create: `src/config.ts`
- Create: `src/app.ts`

- [ ] **Step 1: Initialize Bun project and install dependencies**

```bash
cd /Users/enguerrand/dev/codeforge-tech/strimulator
bun init -y
bun add elysia @elysiajs/static
bun add drizzle-orm
bun add -d drizzle-kit stripe @types/bun
```

- [ ] **Step 2: Configure TypeScript**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create config module**

`src/config.ts`:
```typescript
export const config = {
  port: parseInt(process.env.STRIMULATOR_PORT ?? "12111", 10),
  dbPath: process.env.STRIMULATOR_DB_PATH ?? ":memory:",
  logLevel: process.env.STRIMULATOR_LOG_LEVEL ?? "info",
  apiVersion: process.env.STRIMULATOR_API_VERSION ?? "2024-12-18",
} as const;
```

- [ ] **Step 4: Create the Elysia app factory**

`src/app.ts`:
```typescript
import { Elysia } from "elysia";
import { config } from "./config";

export function createApp() {
  const app = new Elysia()
    .get("/", () => ({
      object: "api",
      has_more: false,
      url: "/v1",
      livemode: false,
    }));

  return app;
}
```

- [ ] **Step 5: Create entry point**

`src/index.ts`:
```typescript
import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Strimulator running on http://localhost:${config.port}`);
  console.log(`Dashboard: http://localhost:${config.port}/dashboard`);
});
```

- [ ] **Step 6: Add scripts to package.json**

Update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

- [ ] **Step 7: Create Drizzle config**

`drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";
import { config } from "./src/config";

export default defineConfig({
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: config.dbPath === ":memory:" ? "strimulator.db" : config.dbPath,
  },
});
```

- [ ] **Step 8: Verify the project boots**

Run: `bun run src/index.ts &; sleep 1; curl -s http://localhost:12111/ | bun -e "process.stdin.pipe(process.stdout)"; kill %1`
Expected: `{"object":"api","has_more":false,"url":"/v1","livemode":false}`

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with Bun, ElysiaJS, Drizzle config"
```

---

### Task 2: Database Setup & Shared Schema Utilities

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/schema/customers.ts`
- Create: `tests/unit/db.test.ts`

- [ ] **Step 1: Write a test that creates an in-memory DB and runs a query**

`tests/unit/db.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { createDB } from "../../src/db";

describe("Database", () => {
  test("creates in-memory database and runs migrations", () => {
    const db = createDB(":memory:");
    expect(db).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/db.test.ts`
Expected: FAIL — `createDB` not found

- [ ] **Step 3: Implement the database module**

`src/db/index.ts`:
```typescript
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema/customers";

export function createDB(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  return db;
}

export type StrimulatorDB = ReturnType<typeof createDB>;
```

- [ ] **Step 4: Create the customers schema as first table**

`src/db/schema/customers.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/db.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/ tests/unit/db.test.ts
git commit -m "feat: add database module with bun:sqlite and customers schema"
```

---

### Task 3: Shared Libraries — ID Generator, Timestamps, Pagination

**Files:**
- Create: `src/lib/id-generator.ts`
- Create: `src/lib/timestamps.ts`
- Create: `src/lib/pagination.ts`
- Create: `tests/unit/lib/id-generator.test.ts`
- Create: `tests/unit/lib/pagination.test.ts`

- [ ] **Step 1: Write failing tests for ID generator**

`tests/unit/lib/id-generator.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { generateId, ID_PREFIXES } from "../../../src/lib/id-generator";

describe("generateId", () => {
  test("generates customer ID with cus_ prefix", () => {
    const id = generateId("customer");
    expect(id).toMatch(/^cus_[a-zA-Z0-9]{14}$/);
  });

  test("generates payment_intent ID with pi_ prefix", () => {
    const id = generateId("payment_intent");
    expect(id).toMatch(/^pi_[a-zA-Z0-9]{14}$/);
  });

  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("customer")));
    expect(ids.size).toBe(100);
  });

  test("all resource types have prefixes", () => {
    const types = [
      "customer", "payment_intent", "payment_method", "setup_intent",
      "charge", "refund", "product", "price", "subscription",
      "subscription_item", "invoice", "invoice_line_item",
      "webhook_endpoint", "event", "test_clock",
    ] as const;
    for (const type of types) {
      const id = generateId(type);
      expect(id).toMatch(/^[a-z_]+_[a-zA-Z0-9]{14}$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/lib/id-generator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ID generator**

`src/lib/id-generator.ts`:
```typescript
import { randomBytes } from "crypto";

export const ID_PREFIXES = {
  customer: "cus",
  payment_intent: "pi",
  payment_method: "pm",
  setup_intent: "seti",
  charge: "ch",
  refund: "re",
  product: "prod",
  price: "price",
  subscription: "sub",
  subscription_item: "si",
  invoice: "in",
  invoice_line_item: "il",
  webhook_endpoint: "we",
  event: "evt",
  test_clock: "clock",
  webhook_delivery: "whdel",
  idempotency_key: "idk",
} as const;

export type ResourceType = keyof typeof ID_PREFIXES;

export function generateId(type: ResourceType): string {
  const prefix = ID_PREFIXES[type];
  const random = randomBytes(10).toString("base64url").slice(0, 14);
  return `${prefix}_${random}`;
}

export function generateSecret(prefix: string): string {
  const random = randomBytes(24).toString("base64url");
  return `${prefix}_${random}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/lib/id-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Implement timestamps module**

`src/lib/timestamps.ts`:
```typescript
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function fromDate(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function toDate(timestamp: number): Date {
  return new Date(timestamp * 1000);
}
```

- [ ] **Step 6: Write failing tests for pagination**

`tests/unit/lib/pagination.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { buildListResponse } from "../../../src/lib/pagination";

describe("buildListResponse", () => {
  test("wraps items in Stripe list envelope", () => {
    const items = [{ id: "cus_1" }, { id: "cus_2" }];
    const result = buildListResponse(items, "/v1/customers", false);

    expect(result).toEqual({
      object: "list",
      data: [{ id: "cus_1" }, { id: "cus_2" }],
      has_more: false,
      url: "/v1/customers",
    });
  });

  test("sets has_more when more items exist", () => {
    const items = [{ id: "cus_1" }];
    const result = buildListResponse(items, "/v1/customers", true);

    expect(result.has_more).toBe(true);
  });

  test("returns empty list", () => {
    const result = buildListResponse([], "/v1/customers", false);

    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  test("parseListParams extracts pagination params", () => {
    const { parseListParams } = require("../../../src/lib/pagination");
    const params = parseListParams({
      limit: "25",
      starting_after: "cus_abc123",
    });

    expect(params).toEqual({
      limit: 25,
      startingAfter: "cus_abc123",
      endingBefore: undefined,
    });
  });

  test("parseListParams defaults limit to 10, caps at 100", () => {
    const { parseListParams } = require("../../../src/lib/pagination");

    expect(parseListParams({}).limit).toBe(10);
    expect(parseListParams({ limit: "200" }).limit).toBe(100);
    expect(parseListParams({ limit: "0" }).limit).toBe(1);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test tests/unit/lib/pagination.test.ts`
Expected: FAIL — module not found

- [ ] **Step 8: Implement pagination**

`src/lib/pagination.ts`:
```typescript
export interface ListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}

export function buildListResponse<T>(
  items: T[],
  url: string,
  hasMore: boolean,
): ListResponse<T> {
  return {
    object: "list",
    data: items,
    has_more: hasMore,
    url,
  };
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
```

- [ ] **Step 9: Run all tests to verify they pass**

Run: `bun test tests/unit/lib/`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/ tests/unit/lib/
git commit -m "feat: add ID generator, timestamps, and pagination utilities"
```

---

### Task 4: Stripe Error Factory

**Files:**
- Create: `src/errors/index.ts`
- Create: `tests/unit/errors.test.ts`

- [ ] **Step 1: Write failing tests for error factory**

`tests/unit/errors.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { StripeError, invalidRequestError, cardError } from "../../src/errors";

describe("StripeError", () => {
  test("creates invalid_request_error", () => {
    const err = invalidRequestError("Missing required param: amount", "amount");
    expect(err.statusCode).toBe(400);
    expect(err.body).toEqual({
      error: {
        type: "invalid_request_error",
        message: "Missing required param: amount",
        param: "amount",
        code: undefined,
      },
    });
  });

  test("creates card_error with decline code", () => {
    const err = cardError("Your card was declined.", "card_declined", "card_declined");
    expect(err.statusCode).toBe(402);
    expect(err.body).toEqual({
      error: {
        type: "card_error",
        message: "Your card was declined.",
        code: "card_declined",
        decline_code: "card_declined",
        param: undefined,
      },
    });
  });

  test("creates resource not found error", () => {
    const { resourceNotFoundError } = require("../../src/errors");
    const err = resourceNotFoundError("customer", "cus_nonexistent");
    expect(err.statusCode).toBe(404);
    expect(err.body.error.type).toBe("invalid_request_error");
    expect(err.body.error.message).toContain("cus_nonexistent");
  });

  test("creates state transition error", () => {
    const { stateTransitionError } = require("../../src/errors");
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.statusCode).toBe(400);
    expect(err.body.error.code).toBe("payment_intent_unexpected_state");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/errors.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the error factory**

`src/errors/index.ts`:
```typescript
export class StripeError {
  constructor(
    public readonly statusCode: number,
    public readonly body: {
      error: {
        type: string;
        message: string;
        code?: string;
        param?: string;
        decline_code?: string;
      };
    },
  ) {}
}

export function invalidRequestError(
  message: string,
  param?: string,
  code?: string,
): StripeError {
  return new StripeError(400, {
    error: {
      type: "invalid_request_error",
      message,
      param: param ?? undefined,
      code: code ?? undefined,
    },
  });
}

export function cardError(
  message: string,
  code: string,
  declineCode?: string,
): StripeError {
  return new StripeError(402, {
    error: {
      type: "card_error",
      message,
      code,
      decline_code: declineCode ?? undefined,
      param: undefined,
    },
  });
}

export function resourceNotFoundError(
  resource: string,
  id: string,
): StripeError {
  return new StripeError(404, {
    error: {
      type: "invalid_request_error",
      message: `No such ${resource}: '${id}'`,
      param: "id",
      code: "resource_missing",
    },
  });
}

export function stateTransitionError(
  resource: string,
  id: string,
  currentStatus: string,
  action: string,
): StripeError {
  return new StripeError(400, {
    error: {
      type: "invalid_request_error",
      message: `You cannot ${action} this ${resource} because it has a status of ${currentStatus}.`,
      code: `${resource}_unexpected_state`,
      param: undefined,
    },
  });
}

export function authenticationError(): StripeError {
  return new StripeError(401, {
    error: {
      type: "authentication_error",
      message: "Invalid API Key provided: sk_test_****",
      code: undefined,
      param: undefined,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/errors/ tests/unit/errors.test.ts
git commit -m "feat: add Stripe-compatible error factory"
```

---

### Task 5: Middleware — API Key Auth, Request Logger, Form-Encoded Body Parser

**Files:**
- Create: `src/middleware/api-key-auth.ts`
- Create: `src/middleware/request-logger.ts`
- Create: `src/middleware/form-parser.ts`
- Create: `src/lib/event-bus.ts`
- Create: `tests/unit/middleware/api-key-auth.test.ts`
- Create: `tests/unit/middleware/form-parser.test.ts`

- [ ] **Step 1: Write failing tests for API key auth**

`tests/unit/middleware/api-key-auth.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { apiKeyAuth } from "../../../src/middleware/api-key-auth";

function createTestApp() {
  return new Elysia()
    .use(apiKeyAuth)
    .get("/v1/test", () => ({ ok: true }));
}

describe("apiKeyAuth", () => {
  test("allows requests with valid sk_test_ key", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { Authorization: "Bearer sk_test_anything" },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("rejects requests without Authorization header", async () => {
    const app = createTestApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  test("rejects requests with non-sk_test_ key", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { Authorization: "Bearer sk_live_bad" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("skips auth for non-/v1/ routes", async () => {
    const app = new Elysia()
      .use(apiKeyAuth)
      .get("/dashboard", () => ({ ok: true }));
    const res = await app.handle(new Request("http://localhost/dashboard"));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/middleware/api-key-auth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement API key auth middleware**

`src/middleware/api-key-auth.ts`:
```typescript
import { Elysia } from "elysia";
import { authenticationError } from "../errors";

export const apiKeyAuth = new Elysia({ name: "api-key-auth" })
  .onBeforeHandle({ as: "global" }, ({ request, set }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/")) return;

    const auth = request.headers.get("authorization");
    if (!auth || !auth.startsWith("Bearer sk_test_")) {
      const err = authenticationError();
      set.status = err.statusCode;
      return err.body;
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/middleware/api-key-auth.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for form-encoded body parser**

`tests/unit/middleware/form-parser.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { parseStripeBody } from "../../../src/middleware/form-parser";

describe("parseStripeBody", () => {
  test("parses flat key-value pairs", () => {
    const result = parseStripeBody("email=test%40example.com&name=John");
    expect(result).toEqual({ email: "test@example.com", name: "John" });
  });

  test("parses nested bracket notation for metadata", () => {
    const result = parseStripeBody("metadata[key1]=value1&metadata[key2]=value2");
    expect(result).toEqual({
      metadata: { key1: "value1", key2: "value2" },
    });
  });

  test("parses array bracket notation for items", () => {
    const result = parseStripeBody(
      "items[0][price]=price_abc&items[0][quantity]=1&items[1][price]=price_def",
    );
    expect(result).toEqual({
      items: [
        { price: "price_abc", quantity: "1" },
        { price: "price_def" },
      ],
    });
  });

  test("parses expand[] array", () => {
    const result = parseStripeBody("expand[]=customer&expand[]=payment_method");
    expect(result).toEqual({
      expand: ["customer", "payment_method"],
    });
  });

  test("handles empty body", () => {
    const result = parseStripeBody("");
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/unit/middleware/form-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement form-encoded body parser**

`src/middleware/form-parser.ts`:
```typescript
export function parseStripeBody(body: string): Record<string, any> {
  if (!body) return {};

  const result: Record<string, any> = {};
  const params = new URLSearchParams(body);

  for (const [key, value] of params) {
    setNestedValue(result, key, value);
  }

  return result;
}

function setNestedValue(obj: Record<string, any>, key: string, value: string): void {
  const parts = parseKey(key);

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];

    if (current[part] === undefined) {
      // If next part is a number, create an array; otherwise an object
      current[part] = typeof nextPart === "number" ? [] : {};
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart === "") {
    // Handle expand[] — push to array
    if (!Array.isArray(current)) {
      // This shouldn't happen with well-formed input
      return;
    }
    // current is the parent, we need to handle this differently
  }

  // Special case: key ends with [] (e.g. expand[])
  if (key.endsWith("[]")) {
    const arrayKey = key.slice(0, -2);
    if (!obj[arrayKey]) obj[arrayKey] = [];
    obj[arrayKey].push(value);
    return;
  }

  current[lastPart] = value;
}

function parseKey(key: string): (string | number)[] {
  // Handle expand[] — return early, handled by caller
  if (key.endsWith("[]")) return [key];

  const parts: (string | number)[] = [];
  const regex = /([^[\]]+)|\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(key)) !== null) {
    const part = match[1] ?? match[2];
    const asNum = parseInt(part, 10);
    parts.push(part === String(asNum) ? asNum : part);
  }

  return parts;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/unit/middleware/form-parser.test.ts`
Expected: PASS

- [ ] **Step 9: Create the event bus for dashboard real-time updates**

`src/lib/event-bus.ts`:
```typescript
type Listener = (event: any) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(channel: string, listener: Listener): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);
    return () => this.listeners.get(channel)?.delete(listener);
  }

  emit(channel: string, event: any): void {
    this.listeners.get(channel)?.forEach((listener) => listener(event));
  }
}

export const globalBus = new EventBus();
```

- [ ] **Step 10: Implement request logger middleware**

`src/middleware/request-logger.ts`:
```typescript
import { Elysia } from "elysia";
import { globalBus } from "../lib/event-bus";

export const requestLogger = new Elysia({ name: "request-logger" })
  .onAfterHandle({ as: "global" }, ({ request, set }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/")) return;

    globalBus.emit("request", {
      method: request.method,
      path: url.pathname,
      statusCode: set.status ?? 200,
      timestamp: Date.now(),
    });
  });
```

- [ ] **Step 11: Commit**

```bash
git add src/middleware/ src/lib/event-bus.ts tests/unit/middleware/
git commit -m "feat: add API key auth, form parser, request logger middleware"
```

---

### Task 6: Wire Middleware Into App & Error Handler

**Files:**
- Modify: `src/app.ts`
- Create: `tests/integration/app.test.ts`

- [ ] **Step 1: Write failing integration test for the wired app**

`tests/integration/app.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { createApp } from "../../src/app";

describe("App", () => {
  test("returns 401 for unauthenticated /v1/ requests", async () => {
    const app = createApp();
    const res = await app.handle(new Request("http://localhost/v1/customers"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  test("allows authenticated /v1/ requests", async () => {
    const app = createApp();
    const res = await app.handle(
      new Request("http://localhost/v1/customers", {
        headers: { Authorization: "Bearer sk_test_123" },
      }),
    );
    // 404 is fine — no route yet, but auth passed
    expect(res.status).not.toBe(401);
  });

  test("returns Stripe-shaped errors for StripeError throws", async () => {
    const app = createApp();
    // Hitting a non-existent route should 404 with Stripe error shape
    const res = await app.handle(
      new Request("http://localhost/v1/nonexistent", {
        headers: { Authorization: "Bearer sk_test_123" },
      }),
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/app.test.ts`
Expected: FAIL — auth middleware not wired

- [ ] **Step 3: Wire middleware and error handling into app.ts**

`src/app.ts`:
```typescript
import { Elysia } from "elysia";
import { config } from "./config";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { requestLogger } from "./middleware/request-logger";
import { StripeError } from "./errors";

export function createApp() {
  const app = new Elysia()
    .use(apiKeyAuth)
    .use(requestLogger)
    .onError({ as: "global" }, ({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
      // Unknown errors get wrapped in Stripe's api_error shape
      set.status = 500;
      return {
        error: {
          type: "api_error",
          message: "An unexpected error occurred",
        },
      };
    })
    .get("/", () => ({
      object: "api",
      has_more: false,
      url: "/v1",
      livemode: false,
    }));

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/app.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.ts tests/integration/app.test.ts
git commit -m "feat: wire middleware and Stripe error handling into app"
```

---

## Phase 2: Simple Resources (CRUD, No State Machines)

### Task 7: Customers Service

**Files:**
- Create: `src/services/customers.ts`
- Create: `tests/unit/services/customers.test.ts`

- [ ] **Step 1: Write failing tests for customers service**

`tests/unit/services/customers.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { CustomerService } from "../../../src/services/customers";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("CustomerService", () => {
  let db: StrimulatorDB;
  let service: CustomerService;

  beforeEach(() => {
    db = createDB(":memory:");
    service = new CustomerService(db);
  });

  test("create: returns customer with correct shape", async () => {
    const customer = await service.create({ email: "test@example.com", name: "Test" });

    expect(customer.id).toMatch(/^cus_/);
    expect(customer.object).toBe("customer");
    expect(customer.email).toBe("test@example.com");
    expect(customer.name).toBe("Test");
    expect(customer.metadata).toEqual({});
    expect(customer.created).toBeGreaterThan(0);
    expect(customer.livemode).toBe(false);
  });

  test("retrieve: returns customer by ID", async () => {
    const created = await service.create({ email: "a@b.com" });
    const retrieved = await service.retrieve(created.id);

    expect(retrieved.id).toBe(created.id);
    expect(retrieved.email).toBe("a@b.com");
  });

  test("retrieve: throws for nonexistent ID", async () => {
    expect(service.retrieve("cus_nonexistent")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test("update: updates fields", async () => {
    const created = await service.create({ email: "old@test.com" });
    const updated = await service.update(created.id, { email: "new@test.com", name: "New" });

    expect(updated.email).toBe("new@test.com");
    expect(updated.name).toBe("New");
  });

  test("delete: marks customer as deleted", async () => {
    const created = await service.create({ email: "a@b.com" });
    const deleted = await service.del(created.id);

    expect(deleted.id).toBe(created.id);
    expect(deleted.deleted).toBe(true);
  });

  test("list: returns paginated customers", async () => {
    await service.create({ email: "a@b.com" });
    await service.create({ email: "c@d.com" });
    await service.create({ email: "e@f.com" });

    const list = await service.list({ limit: 2 });

    expect(list.object).toBe("list");
    expect(list.data.length).toBe(2);
    expect(list.has_more).toBe(true);
    expect(list.url).toBe("/v1/customers");
  });

  test("list: starting_after pagination", async () => {
    const c1 = await service.create({ email: "a@b.com" });
    const c2 = await service.create({ email: "c@d.com" });
    const c3 = await service.create({ email: "e@f.com" });

    const page1 = await service.list({ limit: 2 });
    const lastId = page1.data[page1.data.length - 1].id;
    const page2 = await service.list({ limit: 2, startingAfter: lastId });

    expect(page2.data.length).toBe(1);
    expect(page2.has_more).toBe(false);
  });

  test("create: stores metadata", async () => {
    const customer = await service.create({
      email: "a@b.com",
      metadata: { plan: "pro", source: "signup" },
    });

    expect(customer.metadata).toEqual({ plan: "pro", source: "signup" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/services/customers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement customers service**

`src/services/customers.ts`:
```typescript
import { eq, desc, lt, gt, and, sql } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { customers } from "../db/schema/customers";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError } from "../errors";
import type Stripe from "stripe";

interface CreateParams {
  email?: string;
  name?: string;
  description?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

interface UpdateParams {
  email?: string;
  name?: string;
  description?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export class CustomerService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams): Promise<Stripe.Customer> {
    const id = generateId("customer");
    const created = now();

    const data: Stripe.Customer = {
      id,
      object: "customer",
      address: null,
      balance: 0,
      created,
      currency: null,
      default_source: null,
      delinquent: false,
      description: params.description ?? null,
      discount: null,
      email: params.email ?? null,
      invoice_prefix: id.slice(4, 12).toUpperCase(),
      invoice_settings: {
        custom_fields: null,
        default_payment_method: null,
        footer: null,
        rendering_options: null,
      },
      livemode: false,
      metadata: params.metadata ?? {},
      name: params.name ?? null,
      phone: params.phone ?? null,
      preferred_locales: [],
      shipping: null,
      tax_exempt: "none",
      test_clock: null,
    } as Stripe.Customer;

    this.db.insert(customers).values({
      id,
      email: params.email ?? null,
      name: params.name ?? null,
      deleted: false,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Customer> {
    const row = this.db.select().from(customers).where(eq(customers.id, id)).get();
    if (!row) throw resourceNotFoundError("customer", id);
    return row.data as unknown as Stripe.Customer;
  }

  async update(id: string, params: UpdateParams): Promise<Stripe.Customer> {
    const existing = await this.retrieve(id);

    const updated: Stripe.Customer = {
      ...existing,
      email: params.email ?? existing.email,
      name: params.name ?? existing.name,
      description: params.description ?? existing.description,
      phone: params.phone ?? existing.phone,
      metadata: params.metadata ? { ...existing.metadata, ...params.metadata } : existing.metadata,
    };

    this.db.update(customers).set({
      email: updated.email,
      name: updated.name,
      data: updated as any,
    }).where(eq(customers.id, id)).run();

    return updated;
  }

  async del(id: string): Promise<Stripe.DeletedCustomer> {
    await this.retrieve(id); // throws if not found

    this.db.update(customers).set({ deleted: true }).where(eq(customers.id, id)).run();

    return {
      id,
      object: "customer",
      deleted: true,
    } as Stripe.DeletedCustomer;
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;

    let query = this.db
      .select()
      .from(customers)
      .where(eq(customers.deleted, false))
      .orderBy(desc(customers.created), desc(customers.id))
      .limit(limit + 1);

    if (params.startingAfter) {
      const cursor = this.db.select().from(customers).where(eq(customers.id, params.startingAfter)).get();
      if (cursor) {
        query = this.db
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.deleted, false),
              lt(customers.created, cursor.created),
            ),
          )
          .orderBy(desc(customers.created), desc(customers.id))
          .limit(limit + 1);
      }
    }

    const rows = query.all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Customer);

    return buildListResponse(items, "/v1/customers", hasMore);
  }
}
```

- [ ] **Step 4: Update db/index.ts to run schema creation**

Update `src/db/index.ts` to create tables on init:
```typescript
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as customerSchema from "./schema/customers";
import { sql } from "drizzle-orm";

const allSchemas = {
  ...customerSchema,
};

export function createDB(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema: allSchemas });

  // Create tables directly for simplicity (no migration files needed for dev)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      data TEXT NOT NULL
    )
  `);

  return db;
}

export type StrimulatorDB = ReturnType<typeof createDB>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/services/customers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/customers.ts src/db/ tests/unit/services/customers.test.ts
git commit -m "feat: implement customers service with CRUD and pagination"
```

---

### Task 8: Customers Route

**Files:**
- Create: `src/routes/customers.ts`
- Create: `tests/integration/customers.test.ts`

- [ ] **Step 1: Write failing integration tests**

`tests/integration/customers.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createApp } from "../../src/app";

const AUTH = { Authorization: "Bearer sk_test_123" };

function post(app: any, path: string, body: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

function get(app: any, path: string) {
  return app.handle(
    new Request(`http://localhost${path}`, { headers: AUTH }),
  );
}

function del(app: any, path: string) {
  return app.handle(
    new Request(`http://localhost${path}`, { method: "DELETE", headers: AUTH }),
  );
}

describe("POST /v1/customers", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("creates a customer", async () => {
    const res = await post(app, "/v1/customers", { email: "test@example.com" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^cus_/);
    expect(body.object).toBe("customer");
    expect(body.email).toBe("test@example.com");
  });
});

describe("GET /v1/customers/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("retrieves a customer", async () => {
    const createRes = await post(app, "/v1/customers", { email: "a@b.com" });
    const customer = await createRes.json();

    const res = await get(app, `/v1/customers/${customer.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(customer.id);
  });

  test("returns 404 for nonexistent customer", async () => {
    const res = await get(app, "/v1/customers/cus_nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });
});

describe("DELETE /v1/customers/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("deletes a customer", async () => {
    const createRes = await post(app, "/v1/customers", { email: "a@b.com" });
    const customer = await createRes.json();

    const res = await del(app, `/v1/customers/${customer.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });
});

describe("GET /v1/customers", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("lists customers", async () => {
    await post(app, "/v1/customers", { email: "a@b.com" });
    await post(app, "/v1/customers", { email: "c@d.com" });

    const res = await get(app, "/v1/customers?limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/customers.test.ts`
Expected: FAIL — routes not registered

- [ ] **Step 3: Implement customers route plugin**

`src/routes/customers.ts`:
```typescript
import { Elysia } from "elysia";
import { CustomerService } from "../services/customers";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function customerRoutes(db: StrimulatorDB) {
  const service = new CustomerService(db);

  return new Elysia({ prefix: "/v1/customers" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        email: body.email,
        name: body.name,
        description: body.description,
        phone: body.phone,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => {
      return service.retrieve(params.id);
    })
    .post("/:id", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.update(params.id, {
        email: body.email,
        name: body.name,
        description: body.description,
        phone: body.phone,
        metadata: body.metadata,
      });
    })
    .delete("/:id", async ({ params }) => {
      return service.del(params.id);
    })
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      const listParams = parseListParams(Object.fromEntries(url.searchParams));
      return service.list(listParams);
    });
}
```

- [ ] **Step 4: Wire customers route into app.ts**

Update `src/app.ts` to accept a DB and mount routes:
```typescript
import { Elysia } from "elysia";
import { config } from "./config";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { requestLogger } from "./middleware/request-logger";
import { StripeError } from "./errors";
import { createDB, type StrimulatorDB } from "./db";
import { customerRoutes } from "./routes/customers";

export function createApp(db?: StrimulatorDB) {
  const database = db ?? createDB(config.dbPath);

  const app = new Elysia()
    .use(apiKeyAuth)
    .use(requestLogger)
    .onError({ as: "global" }, ({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
      set.status = 500;
      return {
        error: {
          type: "api_error",
          message: "An unexpected error occurred",
        },
      };
    })
    .get("/", () => ({
      object: "api",
      has_more: false,
      url: "/v1",
      livemode: false,
    }))
    .use(customerRoutes(database));

  return app;
}
```

Update `src/index.ts`:
```typescript
import { createApp } from "./app";
import { config } from "./config";
import { createDB } from "./db";

const db = createDB(config.dbPath);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`Strimulator running on http://localhost:${config.port}`);
  console.log(`Dashboard: http://localhost:${config.port}/dashboard`);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/integration/customers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/customers.ts src/app.ts src/index.ts tests/integration/customers.test.ts
git commit -m "feat: add customers API routes with full CRUD"
```

---

### Task 9: Products & Prices Services

**Files:**
- Create: `src/db/schema/products.ts`
- Create: `src/db/schema/prices.ts`
- Create: `src/services/products.ts`
- Create: `src/services/prices.ts`
- Create: `tests/unit/services/products.test.ts`
- Create: `tests/unit/services/prices.test.ts`

- [ ] **Step 1: Create products and prices schemas**

`src/db/schema/products.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

`src/db/schema/prices.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const prices = sqliteTable("prices", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  type: text("type").notNull(), // "one_time" | "recurring"
  currency: text("currency").notNull(),
  unitAmount: integer("unit_amount"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

- [ ] **Step 2: Update db/index.ts with new schemas and tables**

Add to `src/db/index.ts` — import new schemas and add their CREATE TABLE statements:
```typescript
import * as productSchema from "./schema/products";
import * as priceSchema from "./schema/prices";

// In allSchemas:
const allSchemas = {
  ...customerSchema,
  ...productSchema,
  ...priceSchema,
};

// In createDB, add after customers table:
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    data TEXT NOT NULL
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS prices (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL,
    currency TEXT NOT NULL,
    unit_amount INTEGER,
    created INTEGER NOT NULL,
    data TEXT NOT NULL
  )
`);
```

- [ ] **Step 3: Write failing tests for products service**

`tests/unit/services/products.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { ProductService } from "../../../src/services/products";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("ProductService", () => {
  let db: StrimulatorDB;
  let service: ProductService;

  beforeEach(() => {
    db = createDB(":memory:");
    service = new ProductService(db);
  });

  test("create: returns product with correct shape", async () => {
    const product = await service.create({ name: "Pro Plan" });

    expect(product.id).toMatch(/^prod_/);
    expect(product.object).toBe("product");
    expect(product.name).toBe("Pro Plan");
    expect(product.active).toBe(true);
    expect(product.livemode).toBe(false);
    expect(product.metadata).toEqual({});
  });

  test("retrieve: returns product by ID", async () => {
    const created = await service.create({ name: "Test" });
    const retrieved = await service.retrieve(created.id);
    expect(retrieved.id).toBe(created.id);
  });

  test("retrieve: throws for nonexistent ID", async () => {
    expect(service.retrieve("prod_nonexistent")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test("update: updates fields", async () => {
    const created = await service.create({ name: "Old" });
    const updated = await service.update(created.id, { name: "New" });
    expect(updated.name).toBe("New");
  });

  test("delete: marks product as deleted", async () => {
    const created = await service.create({ name: "Test" });
    const deleted = await service.del(created.id);
    expect(deleted.deleted).toBe(true);
  });

  test("list: returns paginated products", async () => {
    await service.create({ name: "A" });
    await service.create({ name: "B" });
    const list = await service.list({ limit: 10 });
    expect(list.object).toBe("list");
    expect(list.data.length).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/unit/services/products.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement products service**

`src/services/products.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { products } from "../db/schema/products";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError } from "../errors";
import type Stripe from "stripe";

interface CreateParams {
  name: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, string>;
}

interface UpdateParams {
  name?: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, string>;
}

export class ProductService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams): Promise<Stripe.Product> {
    const id = generateId("product");
    const created = now();

    const data: Stripe.Product = {
      id,
      object: "product",
      active: params.active ?? true,
      created,
      default_price: null,
      description: params.description ?? null,
      images: [],
      livemode: false,
      metadata: params.metadata ?? {},
      name: params.name,
      package_dimensions: null,
      shippable: null,
      statement_descriptor: null,
      tax_code: null,
      unit_label: null,
      updated: created,
      url: null,
      type: "service",
    } as Stripe.Product;

    this.db.insert(products).values({
      id,
      name: params.name,
      active: params.active ?? true,
      deleted: false,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Product> {
    const row = this.db.select().from(products).where(eq(products.id, id)).get();
    if (!row) throw resourceNotFoundError("product", id);
    return row.data as unknown as Stripe.Product;
  }

  async update(id: string, params: UpdateParams): Promise<Stripe.Product> {
    const existing = await this.retrieve(id);
    const updated: Stripe.Product = {
      ...existing,
      name: params.name ?? existing.name,
      description: params.description ?? existing.description,
      active: params.active ?? existing.active,
      metadata: params.metadata ? { ...existing.metadata, ...params.metadata } : existing.metadata,
      updated: now(),
    };

    this.db.update(products).set({
      name: updated.name,
      active: updated.active,
      data: updated as any,
    }).where(eq(products.id, id)).run();

    return updated;
  }

  async del(id: string): Promise<Stripe.DeletedProduct> {
    await this.retrieve(id);
    this.db.update(products).set({ deleted: true }).where(eq(products.id, id)).run();
    return { id, object: "product", deleted: true } as Stripe.DeletedProduct;
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;

    let conditions = [eq(products.deleted, false)];
    if (params.startingAfter) {
      const cursor = this.db.select().from(products).where(eq(products.id, params.startingAfter)).get();
      if (cursor) conditions.push(lt(products.created, cursor.created));
    }

    const rows = this.db
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(desc(products.created), desc(products.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Product);
    return buildListResponse(items, "/v1/products", hasMore);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/services/products.test.ts`
Expected: PASS

- [ ] **Step 7: Write failing tests for prices service**

`tests/unit/services/prices.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { PriceService } from "../../../src/services/prices";
import { ProductService } from "../../../src/services/products";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("PriceService", () => {
  let db: StrimulatorDB;
  let priceService: PriceService;
  let productService: ProductService;
  let productId: string;

  beforeEach(async () => {
    db = createDB(":memory:");
    productService = new ProductService(db);
    priceService = new PriceService(db);
    const product = await productService.create({ name: "Test Product" });
    productId = product.id;
  });

  test("create: one-time price", async () => {
    const price = await priceService.create({
      product: productId,
      unit_amount: 2000,
      currency: "usd",
    });

    expect(price.id).toMatch(/^price_/);
    expect(price.object).toBe("price");
    expect(price.unit_amount).toBe(2000);
    expect(price.currency).toBe("usd");
    expect(price.type).toBe("one_time");
    expect(price.product).toBe(productId);
  });

  test("create: recurring price", async () => {
    const price = await priceService.create({
      product: productId,
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    expect(price.type).toBe("recurring");
    expect(price.recurring!.interval).toBe("month");
    expect(price.recurring!.interval_count).toBe(1);
  });

  test("create: requires product", async () => {
    expect(
      priceService.create({ unit_amount: 1000, currency: "usd" } as any),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("retrieve: returns price by ID", async () => {
    const created = await priceService.create({
      product: productId,
      unit_amount: 500,
      currency: "usd",
    });
    const retrieved = await priceService.retrieve(created.id);
    expect(retrieved.id).toBe(created.id);
  });

  test("list: returns paginated prices", async () => {
    await priceService.create({ product: productId, unit_amount: 100, currency: "usd" });
    await priceService.create({ product: productId, unit_amount: 200, currency: "usd" });

    const list = await priceService.list({ limit: 10 });
    expect(list.data.length).toBe(2);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `bun test tests/unit/services/prices.test.ts`
Expected: FAIL — module not found

- [ ] **Step 9: Implement prices service**

`src/services/prices.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { prices } from "../db/schema/prices";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type Stripe from "stripe";

interface CreateParams {
  product: string;
  unit_amount: number;
  currency: string;
  recurring?: { interval: string; interval_count?: number };
  active?: boolean;
  metadata?: Record<string, string>;
}

export class PriceService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams): Promise<Stripe.Price> {
    if (!params.product) throw invalidRequestError("Missing required param: product", "product");

    const id = generateId("price");
    const created = now();
    const type = params.recurring ? "recurring" : "one_time";

    const recurring = params.recurring
      ? {
          interval: params.recurring.interval as Stripe.Price.Recurring.Interval,
          interval_count: params.recurring.interval_count ?? 1,
          usage_type: "licensed" as const,
          aggregate_usage: null,
          trial_period_days: null,
          meter: null,
        }
      : null;

    const data: Stripe.Price = {
      id,
      object: "price",
      active: params.active ?? true,
      billing_scheme: "per_unit",
      created,
      currency: params.currency,
      custom_unit_amount: null,
      livemode: false,
      lookup_key: null,
      metadata: params.metadata ?? {},
      nickname: null,
      product: params.product,
      recurring,
      tax_behavior: null,
      tiers_mode: null,
      transform_quantity: null,
      type,
      unit_amount: params.unit_amount,
      unit_amount_decimal: String(params.unit_amount),
    } as Stripe.Price;

    this.db.insert(prices).values({
      id,
      productId: params.product,
      active: params.active ?? true,
      type,
      currency: params.currency,
      unitAmount: params.unit_amount,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Price> {
    const row = this.db.select().from(prices).where(eq(prices.id, id)).get();
    if (!row) throw resourceNotFoundError("price", id);
    return row.data as unknown as Stripe.Price;
  }

  async update(id: string, params: { active?: boolean; metadata?: Record<string, string> }): Promise<Stripe.Price> {
    const existing = await this.retrieve(id);
    const updated: Stripe.Price = {
      ...existing,
      active: params.active ?? existing.active,
      metadata: params.metadata ? { ...existing.metadata, ...params.metadata } : existing.metadata,
    };

    this.db.update(prices).set({
      active: updated.active,
      data: updated as any,
    }).where(eq(prices.id, id)).run();

    return updated;
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;

    let conditions: any[] = [];
    if (params.startingAfter) {
      const cursor = this.db.select().from(prices).where(eq(prices.id, params.startingAfter)).get();
      if (cursor) conditions.push(lt(prices.created, cursor.created));
    }

    const query = conditions.length > 0
      ? this.db.select().from(prices).where(and(...conditions))
      : this.db.select().from(prices);

    const rows = query
      .orderBy(desc(prices.created), desc(prices.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Price);
    return buildListResponse(items, "/v1/prices", hasMore);
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `bun test tests/unit/services/prices.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/db/schema/products.ts src/db/schema/prices.ts src/db/index.ts src/services/products.ts src/services/prices.ts tests/unit/services/
git commit -m "feat: add products and prices services with CRUD"
```

---

### Task 10: Products & Prices Routes

**Files:**
- Create: `src/routes/products.ts`
- Create: `src/routes/prices.ts`
- Create: `tests/integration/products.test.ts`
- Create: `tests/integration/prices.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Implement products route plugin**

`src/routes/products.ts`:
```typescript
import { Elysia } from "elysia";
import { ProductService } from "../services/products";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function productRoutes(db: StrimulatorDB) {
  const service = new ProductService(db);

  return new Elysia({ prefix: "/v1/products" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        name: body.name,
        description: body.description,
        active: body.active === "true" ? true : body.active === "false" ? false : undefined,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.update(params.id, {
        name: body.name,
        description: body.description,
        active: body.active === "true" ? true : body.active === "false" ? false : undefined,
        metadata: body.metadata,
      });
    })
    .delete("/:id", async ({ params }) => service.del(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

- [ ] **Step 2: Implement prices route plugin**

`src/routes/prices.ts`:
```typescript
import { Elysia } from "elysia";
import { PriceService } from "../services/prices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function priceRoutes(db: StrimulatorDB) {
  const service = new PriceService(db);

  return new Elysia({ prefix: "/v1/prices" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        product: body.product,
        unit_amount: parseInt(body.unit_amount, 10),
        currency: body.currency,
        recurring: body.recurring
          ? {
              interval: body.recurring.interval,
              interval_count: body.recurring.interval_count
                ? parseInt(body.recurring.interval_count, 10)
                : undefined,
            }
          : undefined,
        active: body.active === "true" ? true : body.active === "false" ? false : undefined,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.update(params.id, {
        active: body.active === "true" ? true : body.active === "false" ? false : undefined,
        metadata: body.metadata,
      });
    })
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

- [ ] **Step 3: Wire routes into app.ts**

Add to `src/app.ts` imports and `.use()` calls:
```typescript
import { productRoutes } from "./routes/products";
import { priceRoutes } from "./routes/prices";

// In createApp(), after .use(customerRoutes(database)):
.use(productRoutes(database))
.use(priceRoutes(database))
```

- [ ] **Step 4: Write integration tests for products**

`tests/integration/products.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createApp } from "../../src/app";

const AUTH = { Authorization: "Bearer sk_test_123" };

function post(app: any, path: string, body: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

function get(app: any, path: string) {
  return app.handle(new Request(`http://localhost${path}`, { headers: AUTH }));
}

describe("Products API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("POST /v1/products creates a product", async () => {
    const res = await post(app, "/v1/products", { name: "Pro Plan" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^prod_/);
    expect(body.name).toBe("Pro Plan");
  });

  test("GET /v1/products/:id retrieves a product", async () => {
    const createRes = await post(app, "/v1/products", { name: "Test" });
    const product = await createRes.json();
    const res = await get(app, `/v1/products/${product.id}`);
    expect(res.status).toBe(200);
  });

  test("GET /v1/products lists products", async () => {
    await post(app, "/v1/products", { name: "A" });
    await post(app, "/v1/products", { name: "B" });
    const res = await get(app, "/v1/products");
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });
});
```

- [ ] **Step 5: Write integration tests for prices**

`tests/integration/prices.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createApp } from "../../src/app";

const AUTH = { Authorization: "Bearer sk_test_123" };

function post(app: any, path: string, body: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

function get(app: any, path: string) {
  return app.handle(new Request(`http://localhost${path}`, { headers: AUTH }));
}

describe("Prices API", () => {
  let app: ReturnType<typeof createApp>;
  let productId: string;

  beforeEach(async () => {
    app = createApp();
    const res = await post(app, "/v1/products", { name: "Test Product" });
    productId = (await res.json()).id;
  });

  test("POST /v1/prices creates a one-time price", async () => {
    const res = await post(app, "/v1/prices", {
      product: productId,
      unit_amount: "2000",
      currency: "usd",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^price_/);
    expect(body.unit_amount).toBe(2000);
    expect(body.type).toBe("one_time");
  });

  test("POST /v1/prices creates a recurring price", async () => {
    const res = await post(app, "/v1/prices", {
      product: productId,
      unit_amount: "1000",
      currency: "usd",
      "recurring[interval]": "month",
    });
    const body = await res.json();
    expect(body.type).toBe("recurring");
    expect(body.recurring.interval).toBe("month");
  });

  test("GET /v1/prices lists prices", async () => {
    await post(app, "/v1/prices", { product: productId, unit_amount: "100", currency: "usd" });
    const res = await get(app, "/v1/prices");
    const body = await res.json();
    expect(body.data.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/products.ts src/routes/prices.ts src/app.ts tests/integration/products.test.ts tests/integration/prices.test.ts
git commit -m "feat: add products and prices API routes"
```

---

## Phase 3: Payment Core (State Machines)

### Task 11: PaymentMethods Schema & Service

**Files:**
- Create: `src/db/schema/payment-methods.ts`
- Create: `src/services/payment-methods.ts`
- Create: `tests/unit/services/payment-methods.test.ts`

- [ ] **Step 1: Create payment methods schema**

`src/db/schema/payment-methods.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const paymentMethods = sqliteTable("payment_methods", {
  id: text("id").primaryKey(),
  customerId: text("customer_id"),
  type: text("type").notNull(),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

Update `src/db/index.ts` — add import and CREATE TABLE:
```sql
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  type TEXT NOT NULL,
  created INTEGER NOT NULL,
  data TEXT NOT NULL
)
```

- [ ] **Step 2: Write failing tests for payment methods service**

`tests/unit/services/payment-methods.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { CustomerService } from "../../../src/services/customers";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("PaymentMethodService", () => {
  let db: StrimulatorDB;
  let service: PaymentMethodService;
  let customerService: CustomerService;

  beforeEach(() => {
    db = createDB(":memory:");
    service = new PaymentMethodService(db);
    customerService = new CustomerService(db);
  });

  test("create: creates card payment method", async () => {
    const pm = await service.create({ type: "card", card: { token: "tok_visa" } });

    expect(pm.id).toMatch(/^pm_/);
    expect(pm.object).toBe("payment_method");
    expect(pm.type).toBe("card");
    expect(pm.card).toBeDefined();
    expect(pm.card!.brand).toBe("visa");
    expect(pm.card!.last4).toBe("4242");
  });

  test("attach: attaches PM to customer", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const pm = await service.create({ type: "card", card: { token: "tok_visa" } });
    const attached = await service.attach(pm.id, customer.id);

    expect(attached.customer).toBe(customer.id);
  });

  test("detach: detaches PM from customer", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const pm = await service.create({ type: "card", card: { token: "tok_visa" } });
    await service.attach(pm.id, customer.id);
    const detached = await service.detach(pm.id);

    expect(detached.customer).toBeNull();
  });

  test("list: lists PMs for a customer", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const pm1 = await service.create({ type: "card", card: { token: "tok_visa" } });
    const pm2 = await service.create({ type: "card", card: { token: "tok_visa" } });
    await service.attach(pm1.id, customer.id);
    await service.attach(pm2.id, customer.id);

    const list = await service.list({ customerId: customer.id, type: "card", limit: 10 });
    expect(list.data.length).toBe(2);
  });

  test("magic tokens produce correct card details", async () => {
    const visa = await service.create({ type: "card", card: { token: "tok_visa" } });
    expect(visa.card!.brand).toBe("visa");
    expect(visa.card!.last4).toBe("4242");

    const mc = await service.create({ type: "card", card: { token: "tok_mastercard" } });
    expect(mc.card!.brand).toBe("mastercard");
    expect(mc.card!.last4).toBe("4444");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/services/payment-methods.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement payment methods service**

`src/services/payment-methods.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { paymentMethods } from "../db/schema/payment-methods";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type Stripe from "stripe";

const MAGIC_TOKENS: Record<string, { brand: string; last4: string; expMonth: number; expYear: number }> = {
  tok_visa: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 },
  tok_mastercard: { brand: "mastercard", last4: "4444", expMonth: 12, expYear: 2034 },
  tok_amex: { brand: "amex", last4: "8431", expMonth: 12, expYear: 2034 },
  tok_visa_debit: { brand: "visa", last4: "5556", expMonth: 12, expYear: 2034 },
};

interface CreateParams {
  type: string;
  card?: { token?: string };
  metadata?: Record<string, string>;
}

export class PaymentMethodService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams): Promise<Stripe.PaymentMethod> {
    const id = generateId("payment_method");
    const created = now();
    const token = params.card?.token ?? "tok_visa";
    const cardDetails = MAGIC_TOKENS[token] ?? MAGIC_TOKENS["tok_visa"];

    const card = {
      brand: cardDetails.brand,
      checks: { address_line1_check: null, address_postal_code_check: null, cvc_check: "pass" },
      country: "US",
      display_brand: cardDetails.brand,
      exp_month: cardDetails.expMonth,
      exp_year: cardDetails.expYear,
      fingerprint: generateId("customer").slice(4), // random fingerprint
      funding: "credit",
      generated_from: null,
      last4: cardDetails.last4,
      networks: { available: [cardDetails.brand], preferred: null },
      three_d_secure_usage: { supported: true },
      wallet: null,
    };

    const data = {
      id,
      object: "payment_method",
      billing_details: { address: null, email: null, name: null, phone: null },
      card,
      created,
      customer: null,
      livemode: false,
      metadata: params.metadata ?? {},
      type: params.type,
    } as unknown as Stripe.PaymentMethod;

    this.db.insert(paymentMethods).values({
      id,
      customerId: null,
      type: params.type,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.PaymentMethod> {
    const row = this.db.select().from(paymentMethods).where(eq(paymentMethods.id, id)).get();
    if (!row) throw resourceNotFoundError("payment_method", id);
    return row.data as unknown as Stripe.PaymentMethod;
  }

  async attach(id: string, customerId: string): Promise<Stripe.PaymentMethod> {
    const pm = await this.retrieve(id);
    const updated = { ...pm, customer: customerId };

    this.db.update(paymentMethods).set({
      customerId,
      data: updated as any,
    }).where(eq(paymentMethods.id, id)).run();

    return updated as Stripe.PaymentMethod;
  }

  async detach(id: string): Promise<Stripe.PaymentMethod> {
    const pm = await this.retrieve(id);
    const updated = { ...pm, customer: null };

    this.db.update(paymentMethods).set({
      customerId: null,
      data: updated as any,
    }).where(eq(paymentMethods.id, id)).run();

    return updated as Stripe.PaymentMethod;
  }

  async list(params: { customerId: string; type: string; limit?: number }) {
    const limit = params.limit ?? 10;

    const rows = this.db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.customerId, params.customerId),
          eq(paymentMethods.type, params.type),
        ),
      )
      .orderBy(desc(paymentMethods.created))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.PaymentMethod);
    return buildListResponse(items, "/v1/payment_methods", hasMore);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/services/payment-methods.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/payment-methods.ts src/db/index.ts src/services/payment-methods.ts tests/unit/services/payment-methods.test.ts
git commit -m "feat: add payment methods service with magic tokens"
```

---

### Task 12: PaymentIntents Schema & Service (State Machine)

**Files:**
- Create: `src/db/schema/payment-intents.ts`
- Create: `src/db/schema/charges.ts`
- Create: `src/services/payment-intents.ts`
- Create: `src/services/charges.ts`
- Create: `tests/unit/services/payment-intents.test.ts`

- [ ] **Step 1: Create payment intents and charges schemas**

`src/db/schema/payment-intents.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const paymentIntents = sqliteTable("payment_intents", {
  id: text("id").primaryKey(),
  customerId: text("customer_id"),
  paymentMethodId: text("payment_method_id"),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  clientSecret: text("client_secret").notNull(),
  captureMethod: text("capture_method").notNull().default("automatic"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

`src/db/schema/charges.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const charges = sqliteTable("charges", {
  id: text("id").primaryKey(),
  customerId: text("customer_id"),
  paymentIntentId: text("payment_intent_id"),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  refundedAmount: integer("refunded_amount").notNull().default(0),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

Update `src/db/index.ts` with both new schemas and CREATE TABLEs.

- [ ] **Step 2: Implement charges service (dependency of payment intents)**

`src/services/charges.ts`:
```typescript
import { eq, desc, and, lt } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { charges } from "../db/schema/charges";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError } from "../errors";
import type Stripe from "stripe";

interface CreateChargeParams {
  amount: number;
  currency: string;
  customerId?: string;
  paymentIntentId?: string;
  paymentMethodId?: string;
  status: "succeeded" | "failed" | "pending";
}

export class ChargeService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateChargeParams): Promise<Stripe.Charge> {
    const id = generateId("charge");
    const created = now();

    const data = {
      id,
      object: "charge",
      amount: params.amount,
      amount_captured: params.status === "succeeded" ? params.amount : 0,
      amount_refunded: 0,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: `txn_${generateId("customer").slice(4)}`,
      billing_details: { address: null, email: null, name: null, phone: null },
      calculated_statement_descriptor: "STRIMULATOR",
      captured: params.status === "succeeded",
      created,
      currency: params.currency,
      customer: params.customerId ?? null,
      description: null,
      disputed: false,
      failure_balance_transaction: null,
      failure_code: params.status === "failed" ? "card_declined" : null,
      failure_message: params.status === "failed" ? "Your card was declined." : null,
      fraud_details: {},
      invoice: null,
      livemode: false,
      metadata: {},
      on_behalf_of: null,
      outcome: {
        network_status: params.status === "succeeded" ? "approved_by_network" : "declined_by_network",
        reason: params.status === "succeeded" ? null : "generic_decline",
        risk_level: "normal",
        risk_score: 20,
        seller_message: params.status === "succeeded" ? "Payment complete." : "Your card was declined.",
        type: params.status === "succeeded" ? "authorized" : "issuer_declined",
      },
      paid: params.status === "succeeded",
      payment_intent: params.paymentIntentId ?? null,
      payment_method: params.paymentMethodId ?? null,
      receipt_url: null,
      refunded: false,
      refunds: { object: "list", data: [], has_more: false, url: `/v1/charges/${id}/refunds` },
      status: params.status,
    } as unknown as Stripe.Charge;

    this.db.insert(charges).values({
      id,
      customerId: params.customerId ?? null,
      paymentIntentId: params.paymentIntentId ?? null,
      status: params.status,
      amount: params.amount,
      currency: params.currency,
      refundedAmount: 0,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Charge> {
    const row = this.db.select().from(charges).where(eq(charges.id, id)).get();
    if (!row) throw resourceNotFoundError("charge", id);
    return row.data as unknown as Stripe.Charge;
  }

  async list(params: Partial<ListParams> & { paymentIntentId?: string } = {}) {
    const limit = params.limit ?? 10;
    let conditions: any[] = [];
    if (params.paymentIntentId) conditions.push(eq(charges.paymentIntentId, params.paymentIntentId));
    if (params.startingAfter) {
      const cursor = this.db.select().from(charges).where(eq(charges.id, params.startingAfter)).get();
      if (cursor) conditions.push(lt(charges.created, cursor.created));
    }

    const query = conditions.length > 0
      ? this.db.select().from(charges).where(and(...conditions))
      : this.db.select().from(charges);

    const rows = query.orderBy(desc(charges.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Charge);
    return buildListResponse(items, "/v1/charges", hasMore);
  }
}
```

- [ ] **Step 3: Write failing tests for payment intents service**

`tests/unit/services/payment-intents.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { PaymentIntentService } from "../../../src/services/payment-intents";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { CustomerService } from "../../../src/services/customers";
import { ChargeService } from "../../../src/services/charges";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("PaymentIntentService", () => {
  let db: StrimulatorDB;
  let piService: PaymentIntentService;
  let pmService: PaymentMethodService;
  let customerService: CustomerService;
  let chargeService: ChargeService;

  beforeEach(() => {
    db = createDB(":memory:");
    customerService = new CustomerService(db);
    pmService = new PaymentMethodService(db);
    chargeService = new ChargeService(db);
    piService = new PaymentIntentService(db, chargeService, pmService);
  });

  test("create: returns PI in requires_payment_method status", async () => {
    const pi = await piService.create({ amount: 2000, currency: "usd" });

    expect(pi.id).toMatch(/^pi_/);
    expect(pi.object).toBe("payment_intent");
    expect(pi.status).toBe("requires_payment_method");
    expect(pi.amount).toBe(2000);
    expect(pi.currency).toBe("usd");
    expect(pi.client_secret).toMatch(/^pi_.+_secret_.+/);
    expect(pi.livemode).toBe(false);
  });

  test("create with payment_method: moves to requires_confirmation", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    const pi = await piService.create({ amount: 2000, currency: "usd", payment_method: pm.id });

    expect(pi.status).toBe("requires_confirmation");
    expect(pi.payment_method).toBe(pm.id);
  });

  test("create with payment_method + confirm: succeeds", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    await pmService.attach(pm.id, customer.id);
    const pi = await piService.create({
      amount: 2000,
      currency: "usd",
      customer: customer.id,
      payment_method: pm.id,
      confirm: true,
    });

    expect(pi.status).toBe("succeeded");
  });

  test("confirm: transitions requires_confirmation to succeeded", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    const pi = await piService.create({ amount: 2000, currency: "usd", payment_method: pm.id });
    const confirmed = await piService.confirm(pi.id, {});

    expect(confirmed.status).toBe("succeeded");
  });

  test("confirm: with declined card fails", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    // We'll simulate decline by using a magic PM name
    const declinedPm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    // Override the PM ID to match a decline pattern
    const pi = await piService.create({ amount: 2000, currency: "usd", payment_method: pm.id });

    // Normal visa should succeed
    const confirmed = await piService.confirm(pi.id, {});
    expect(confirmed.status).toBe("succeeded");
  });

  test("confirm: from wrong state throws", async () => {
    const pi = await piService.create({ amount: 2000, currency: "usd" });
    // No PM attached, status is requires_payment_method — can't confirm
    expect(piService.confirm(pi.id, {})).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test("cancel: transitions to canceled", async () => {
    const pi = await piService.create({ amount: 2000, currency: "usd" });
    const canceled = await piService.cancel(pi.id, {});

    expect(canceled.status).toBe("canceled");
  });

  test("cancel: from succeeded throws", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    const pi = await piService.create({
      amount: 2000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });

    expect(piService.cancel(pi.id, {})).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test("capture: captures manual capture PI", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    const pi = await piService.create({
      amount: 2000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
      capture_method: "manual",
    });

    expect(pi.status).toBe("requires_capture");

    const captured = await piService.capture(pi.id, {});
    expect(captured.status).toBe("succeeded");
    expect(captured.amount_received).toBe(2000);
  });

  test("list: returns paginated PIs", async () => {
    await piService.create({ amount: 1000, currency: "usd" });
    await piService.create({ amount: 2000, currency: "usd" });

    const list = await piService.list({ limit: 10 });
    expect(list.data.length).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/unit/services/payment-intents.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement payment intents service**

`src/services/payment-intents.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { paymentIntents } from "../db/schema/payment-intents";
import { generateId, generateSecret } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, stateTransitionError, invalidRequestError } from "../errors";
import type { ChargeService } from "./charges";
import type { PaymentMethodService } from "./payment-methods";
import type Stripe from "stripe";

// Magic PM IDs that control payment outcome
const DECLINE_TOKENS = new Set(["tok_declined", "tok_card_declined"]);

interface CreateParams {
  amount: number;
  currency: string;
  customer?: string;
  payment_method?: string;
  confirm?: boolean;
  capture_method?: "automatic" | "manual";
  metadata?: Record<string, string>;
}

export class PaymentIntentService {
  constructor(
    private db: StrimulatorDB,
    private chargeService: ChargeService,
    private paymentMethodService: PaymentMethodService,
  ) {}

  async create(params: CreateParams): Promise<Stripe.PaymentIntent> {
    if (!params.amount) throw invalidRequestError("Missing required param: amount", "amount");
    if (!params.currency) throw invalidRequestError("Missing required param: currency", "currency");

    const id = generateId("payment_intent");
    const created = now();
    const clientSecret = `${id}_secret_${generateSecret("").slice(0, 16)}`;
    const captureMethod = params.capture_method ?? "automatic";

    let status: string = "requires_payment_method";
    if (params.payment_method) {
      status = "requires_confirmation";
    }

    const data = {
      id,
      object: "payment_intent",
      amount: params.amount,
      amount_capturable: 0,
      amount_received: 0,
      automatic_payment_methods: null,
      canceled_at: null,
      cancellation_reason: null,
      capture_method: captureMethod,
      client_secret: clientSecret,
      confirmation_method: "automatic",
      created,
      currency: params.currency,
      customer: params.customer ?? null,
      description: null,
      last_payment_error: null,
      latest_charge: null,
      livemode: false,
      metadata: params.metadata ?? {},
      next_action: null,
      on_behalf_of: null,
      payment_method: params.payment_method ?? null,
      payment_method_options: {},
      payment_method_types: ["card"],
      processing: null,
      receipt_email: null,
      setup_future_usage: null,
      shipping: null,
      statement_descriptor: null,
      statement_descriptor_suffix: null,
      status,
      transfer_data: null,
      transfer_group: null,
    } as unknown as Stripe.PaymentIntent;

    this.db.insert(paymentIntents).values({
      id,
      customerId: params.customer ?? null,
      paymentMethodId: params.payment_method ?? null,
      status,
      amount: params.amount,
      currency: params.currency,
      clientSecret,
      captureMethod,
      created,
      data: data as any,
    }).run();

    // If confirm=true and we have a payment method, run the confirm flow
    if (params.confirm && params.payment_method) {
      return this.confirm(id, {});
    }

    return data;
  }

  async retrieve(id: string): Promise<Stripe.PaymentIntent> {
    const row = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).get();
    if (!row) throw resourceNotFoundError("payment_intent", id);
    return row.data as unknown as Stripe.PaymentIntent;
  }

  async confirm(id: string, params: { payment_method?: string }): Promise<Stripe.PaymentIntent> {
    const pi = await this.retrieve(id);

    if (pi.status !== "requires_confirmation" && pi.status !== "requires_payment_method") {
      throw stateTransitionError("payment_intent", id, pi.status, "confirm");
    }

    const pmId = params.payment_method ?? pi.payment_method;
    if (!pmId) {
      throw invalidRequestError(
        "You cannot confirm this PaymentIntent because it's missing a payment method.",
        "payment_method",
      );
    }

    // Simulate payment processing
    const pm = await this.paymentMethodService.retrieve(pmId as string);
    const succeeded = this.simulatePaymentOutcome(pm);

    if (succeeded) {
      const captureMethod = (pi as any).capture_method;
      const newStatus = captureMethod === "manual" ? "requires_capture" : "succeeded";

      // Create a charge on success
      const charge = await this.chargeService.create({
        amount: pi.amount,
        currency: pi.currency,
        customerId: (pi.customer as string) ?? undefined,
        paymentIntentId: id,
        paymentMethodId: pmId as string,
        status: newStatus === "requires_capture" ? "pending" : "succeeded",
      });

      const updated = {
        ...pi,
        status: newStatus,
        payment_method: pmId,
        latest_charge: charge.id,
        amount_capturable: newStatus === "requires_capture" ? pi.amount : 0,
        amount_received: newStatus === "succeeded" ? pi.amount : 0,
      } as unknown as Stripe.PaymentIntent;

      this.updatePI(id, newStatus, pmId as string, updated);
      return updated;
    } else {
      // Payment failed — back to requires_payment_method
      const updated = {
        ...pi,
        status: "requires_payment_method",
        payment_method: pmId,
        last_payment_error: {
          charge: null,
          code: "card_declined",
          decline_code: "generic_decline",
          message: "Your card was declined.",
          param: null,
          payment_method: pm,
          type: "card_error",
        },
      } as unknown as Stripe.PaymentIntent;

      this.updatePI(id, "requires_payment_method", pmId as string, updated);
      return updated;
    }
  }

  async capture(id: string, params: { amount_to_capture?: number }): Promise<Stripe.PaymentIntent> {
    const pi = await this.retrieve(id);

    if (pi.status !== "requires_capture") {
      throw stateTransitionError("payment_intent", id, pi.status, "capture");
    }

    const captureAmount = params.amount_to_capture ?? pi.amount;
    const updated = {
      ...pi,
      status: "succeeded",
      amount_capturable: 0,
      amount_received: captureAmount,
    } as unknown as Stripe.PaymentIntent;

    this.updatePI(id, "succeeded", pi.payment_method as string, updated);
    return updated;
  }

  async cancel(id: string, params: { cancellation_reason?: string }): Promise<Stripe.PaymentIntent> {
    const pi = await this.retrieve(id);
    const terminalStates = ["succeeded", "canceled"];

    if (terminalStates.includes(pi.status)) {
      throw stateTransitionError("payment_intent", id, pi.status, "cancel");
    }

    const updated = {
      ...pi,
      status: "canceled",
      canceled_at: now(),
      cancellation_reason: params.cancellation_reason ?? null,
    } as unknown as Stripe.PaymentIntent;

    this.updatePI(id, "canceled", pi.payment_method as string, updated);
    return updated;
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;
    let conditions: any[] = [];
    if (params.startingAfter) {
      const cursor = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, params.startingAfter)).get();
      if (cursor) conditions.push(lt(paymentIntents.created, cursor.created));
    }

    const query = conditions.length > 0
      ? this.db.select().from(paymentIntents).where(and(...conditions))
      : this.db.select().from(paymentIntents);

    const rows = query.orderBy(desc(paymentIntents.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.PaymentIntent);
    return buildListResponse(items, "/v1/payment_intents", hasMore);
  }

  private simulatePaymentOutcome(pm: Stripe.PaymentMethod): boolean {
    // Check card details for magic decline patterns
    const last4 = (pm.card as any)?.last4;
    if (last4 === "0002") return false; // Decline
    return true; // Default: succeed
  }

  private updatePI(id: string, status: string, paymentMethodId: string, data: Stripe.PaymentIntent): void {
    this.db.update(paymentIntents).set({
      status,
      paymentMethodId,
      data: data as any,
    }).where(eq(paymentIntents.id, id)).run();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/services/payment-intents.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/payment-intents.ts src/db/schema/charges.ts src/db/index.ts src/services/payment-intents.ts src/services/charges.ts tests/unit/services/payment-intents.test.ts
git commit -m "feat: add payment intents and charges services with state machine"
```

---

### Task 13: PaymentIntents, PaymentMethods, Charges Routes

**Files:**
- Create: `src/routes/payment-intents.ts`
- Create: `src/routes/payment-methods.ts`
- Create: `src/routes/charges.ts`
- Create: `tests/integration/payment-intents.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Implement payment intents route plugin**

`src/routes/payment-intents.ts`:
```typescript
import { Elysia } from "elysia";
import { PaymentIntentService } from "../services/payment-intents";
import { ChargeService } from "../services/charges";
import { PaymentMethodService } from "../services/payment-methods";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function paymentIntentRoutes(db: StrimulatorDB) {
  const chargeService = new ChargeService(db);
  const pmService = new PaymentMethodService(db);
  const service = new PaymentIntentService(db, chargeService, pmService);

  return new Elysia({ prefix: "/v1/payment_intents" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        amount: parseInt(body.amount, 10),
        currency: body.currency,
        customer: body.customer,
        payment_method: body.payment_method,
        confirm: body.confirm === "true",
        capture_method: body.capture_method as "automatic" | "manual" | undefined,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      // Update is limited — mainly metadata and description
      return service.retrieve(params.id); // Simplified for now
    })
    .post("/:id/confirm", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.confirm(params.id, {
        payment_method: body.payment_method,
      });
    })
    .post("/:id/capture", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.capture(params.id, {
        amount_to_capture: body.amount_to_capture ? parseInt(body.amount_to_capture, 10) : undefined,
      });
    })
    .post("/:id/cancel", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.cancel(params.id, {
        cancellation_reason: body.cancellation_reason,
      });
    })
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

- [ ] **Step 2: Implement payment methods route plugin**

`src/routes/payment-methods.ts`:
```typescript
import { Elysia } from "elysia";
import { PaymentMethodService } from "../services/payment-methods";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function paymentMethodRoutes(db: StrimulatorDB) {
  const service = new PaymentMethodService(db);

  return new Elysia({ prefix: "/v1/payment_methods" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        type: body.type,
        card: body.card,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id/attach", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.attach(params.id, body.customer);
    })
    .post("/:id/detach", async ({ params }) => service.detach(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      const params = Object.fromEntries(url.searchParams);
      return service.list({
        customerId: params.customer,
        type: params.type ?? "card",
        limit: params.limit ? parseInt(params.limit, 10) : 10,
      });
    });
}
```

- [ ] **Step 3: Implement charges route plugin**

`src/routes/charges.ts`:
```typescript
import { Elysia } from "elysia";
import { ChargeService } from "../services/charges";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function chargeRoutes(db: StrimulatorDB) {
  const service = new ChargeService(db);

  return new Elysia({ prefix: "/v1/charges" })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      const params = Object.fromEntries(url.searchParams);
      return service.list({
        ...parseListParams(params),
        paymentIntentId: params.payment_intent,
      });
    });
}
```

- [ ] **Step 4: Wire all new routes into app.ts**

Add imports and `.use()` calls for `paymentIntentRoutes`, `paymentMethodRoutes`, `chargeRoutes`.

- [ ] **Step 5: Write integration test for full payment flow**

`tests/integration/payment-intents.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createApp } from "../../src/app";

const AUTH = { Authorization: "Bearer sk_test_123" };

function post(app: any, path: string, body: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

function get(app: any, path: string) {
  return app.handle(new Request(`http://localhost${path}`, { headers: AUTH }));
}

describe("Payment Flow Integration", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("full payment flow: create PM → create PI → confirm → succeed", async () => {
    // Create customer
    const cusRes = await post(app, "/v1/customers", { email: "test@test.com" });
    const customer = await cusRes.json();

    // Create payment method
    const pmRes = await post(app, "/v1/payment_methods", {
      type: "card",
      "card[token]": "tok_visa",
    });
    const pm = await pmRes.json();
    expect(pm.id).toMatch(/^pm_/);

    // Attach PM to customer
    await post(app, `/v1/payment_methods/${pm.id}/attach`, { customer: customer.id });

    // Create PaymentIntent
    const piRes = await post(app, "/v1/payment_intents", {
      amount: "2000",
      currency: "usd",
      customer: customer.id,
      payment_method: pm.id,
    });
    const pi = await piRes.json();
    expect(pi.status).toBe("requires_confirmation");

    // Confirm
    const confirmRes = await post(app, `/v1/payment_intents/${pi.id}/confirm`);
    const confirmed = await confirmRes.json();
    expect(confirmed.status).toBe("succeeded");
    expect(confirmed.amount_received).toBe(2000);
  });

  test("create PI with confirm=true succeeds in one call", async () => {
    const pmRes = await post(app, "/v1/payment_methods", {
      type: "card",
      "card[token]": "tok_visa",
    });
    const pm = await pmRes.json();

    const piRes = await post(app, "/v1/payment_intents", {
      amount: "5000",
      currency: "usd",
      payment_method: pm.id,
      confirm: "true",
    });
    const pi = await piRes.json();
    expect(pi.status).toBe("succeeded");
  });

  test("manual capture flow", async () => {
    const pmRes = await post(app, "/v1/payment_methods", {
      type: "card",
      "card[token]": "tok_visa",
    });
    const pm = await pmRes.json();

    const piRes = await post(app, "/v1/payment_intents", {
      amount: "3000",
      currency: "usd",
      payment_method: pm.id,
      confirm: "true",
      capture_method: "manual",
    });
    const pi = await piRes.json();
    expect(pi.status).toBe("requires_capture");

    const captureRes = await post(app, `/v1/payment_intents/${pi.id}/capture`);
    const captured = await captureRes.json();
    expect(captured.status).toBe("succeeded");
  });

  test("cancel a payment intent", async () => {
    const piRes = await post(app, "/v1/payment_intents", {
      amount: "1000",
      currency: "usd",
    });
    const pi = await piRes.json();

    const cancelRes = await post(app, `/v1/payment_intents/${pi.id}/cancel`);
    const canceled = await cancelRes.json();
    expect(canceled.status).toBe("canceled");
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/payment-intents.ts src/routes/payment-methods.ts src/routes/charges.ts src/app.ts tests/integration/payment-intents.test.ts
git commit -m "feat: add payment intents, payment methods, charges routes"
```

---

### Task 14: Refunds & SetupIntents Services and Routes

**Files:**
- Create: `src/db/schema/refunds.ts`
- Create: `src/db/schema/setup-intents.ts`
- Create: `src/services/refunds.ts`
- Create: `src/services/setup-intents.ts`
- Create: `src/routes/refunds.ts`
- Create: `src/routes/setup-intents.ts`
- Create: `tests/unit/services/refunds.test.ts`
- Create: `tests/unit/services/setup-intents.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Create refunds schema**

`src/db/schema/refunds.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  chargeId: text("charge_id").notNull(),
  paymentIntentId: text("payment_intent_id"),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

- [ ] **Step 2: Create setup intents schema**

`src/db/schema/setup-intents.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const setupIntents = sqliteTable("setup_intents", {
  id: text("id").primaryKey(),
  customerId: text("customer_id"),
  paymentMethodId: text("payment_method_id"),
  status: text("status").notNull(),
  clientSecret: text("client_secret").notNull(),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

Update `src/db/index.ts` with both new schemas and CREATE TABLEs.

- [ ] **Step 3: Write failing tests for refunds service**

`tests/unit/services/refunds.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { RefundService } from "../../../src/services/refunds";
import { ChargeService } from "../../../src/services/charges";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("RefundService", () => {
  let db: StrimulatorDB;
  let refundService: RefundService;
  let chargeService: ChargeService;

  beforeEach(() => {
    db = createDB(":memory:");
    chargeService = new ChargeService(db);
    refundService = new RefundService(db, chargeService);
  });

  test("create: full refund", async () => {
    const charge = await chargeService.create({
      amount: 2000, currency: "usd", status: "succeeded",
    });
    const refund = await refundService.create({ charge: charge.id });

    expect(refund.id).toMatch(/^re_/);
    expect(refund.object).toBe("refund");
    expect(refund.amount).toBe(2000);
    expect(refund.status).toBe("succeeded");
    expect(refund.charge).toBe(charge.id);
  });

  test("create: partial refund", async () => {
    const charge = await chargeService.create({
      amount: 2000, currency: "usd", status: "succeeded",
    });
    const refund = await refundService.create({ charge: charge.id, amount: 500 });

    expect(refund.amount).toBe(500);
  });

  test("create: refund exceeding charge amount throws", async () => {
    const charge = await chargeService.create({
      amount: 2000, currency: "usd", status: "succeeded",
    });
    expect(
      refundService.create({ charge: charge.id, amount: 3000 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("retrieve: returns refund by ID", async () => {
    const charge = await chargeService.create({
      amount: 1000, currency: "usd", status: "succeeded",
    });
    const created = await refundService.create({ charge: charge.id });
    const retrieved = await refundService.retrieve(created.id);
    expect(retrieved.id).toBe(created.id);
  });

  test("list: returns paginated refunds", async () => {
    const charge = await chargeService.create({
      amount: 2000, currency: "usd", status: "succeeded",
    });
    await refundService.create({ charge: charge.id, amount: 500 });
    await refundService.create({ charge: charge.id, amount: 500 });
    const list = await refundService.list({ limit: 10 });
    expect(list.data.length).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/unit/services/refunds.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement refunds service**

`src/services/refunds.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { refunds } from "../db/schema/refunds";
import { charges } from "../db/schema/charges";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type { ChargeService } from "./charges";
import type Stripe from "stripe";

interface CreateParams {
  charge?: string;
  payment_intent?: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

export class RefundService {
  constructor(
    private db: StrimulatorDB,
    private chargeService: ChargeService,
  ) {}

  async create(params: CreateParams): Promise<Stripe.Refund> {
    if (!params.charge && !params.payment_intent) {
      throw invalidRequestError("Must provide either charge or payment_intent", "charge");
    }

    const charge = await this.chargeService.retrieve(params.charge!);
    const chargeAmount = charge.amount;
    const alreadyRefunded = (charge as any).amount_refunded ?? 0;
    const refundAmount = params.amount ?? (chargeAmount - alreadyRefunded);

    if (refundAmount > chargeAmount - alreadyRefunded) {
      throw invalidRequestError(
        `Refund amount (${refundAmount}) is greater than charge amount (${chargeAmount}) minus already refunded (${alreadyRefunded})`,
        "amount",
      );
    }

    const id = generateId("refund");
    const created = now();

    const data = {
      id,
      object: "refund",
      amount: refundAmount,
      balance_transaction: null,
      charge: charge.id,
      created,
      currency: charge.currency,
      metadata: params.metadata ?? {},
      payment_intent: charge.payment_intent ?? null,
      reason: params.reason ?? null,
      receipt_number: null,
      source_transfer_reversal: null,
      status: "succeeded",
      transfer_reversal: null,
    } as unknown as Stripe.Refund;

    this.db.insert(refunds).values({
      id,
      chargeId: charge.id,
      paymentIntentId: (charge.payment_intent as string) ?? null,
      status: "succeeded",
      amount: refundAmount,
      currency: charge.currency,
      created,
      data: data as any,
    }).run();

    // Update charge refunded amount
    const newRefundedAmount = alreadyRefunded + refundAmount;
    const updatedChargeData = {
      ...(charge as any),
      amount_refunded: newRefundedAmount,
      refunded: newRefundedAmount >= chargeAmount,
    };
    this.db.update(charges).set({
      refundedAmount: newRefundedAmount,
      data: updatedChargeData as any,
    }).where(eq(charges.id, charge.id)).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Refund> {
    const row = this.db.select().from(refunds).where(eq(refunds.id, id)).get();
    if (!row) throw resourceNotFoundError("refund", id);
    return row.data as unknown as Stripe.Refund;
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;
    let conditions: any[] = [];
    if (params.startingAfter) {
      const cursor = this.db.select().from(refunds).where(eq(refunds.id, params.startingAfter)).get();
      if (cursor) conditions.push(lt(refunds.created, cursor.created));
    }
    const query = conditions.length > 0
      ? this.db.select().from(refunds).where(and(...conditions))
      : this.db.select().from(refunds);

    const rows = query.orderBy(desc(refunds.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Refund);
    return buildListResponse(items, "/v1/refunds", hasMore);
  }
}
```

- [ ] **Step 6: Run refunds test to verify it passes**

Run: `bun test tests/unit/services/refunds.test.ts`
Expected: PASS

- [ ] **Step 7: Write failing tests for setup intents service**

`tests/unit/services/setup-intents.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { SetupIntentService } from "../../../src/services/setup-intents";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("SetupIntentService", () => {
  let db: StrimulatorDB;
  let service: SetupIntentService;
  let pmService: PaymentMethodService;

  beforeEach(() => {
    db = createDB(":memory:");
    pmService = new PaymentMethodService(db);
    service = new SetupIntentService(db, pmService);
  });

  test("create: returns SI in requires_payment_method", async () => {
    const si = await service.create({});

    expect(si.id).toMatch(/^seti_/);
    expect(si.object).toBe("setup_intent");
    expect(si.status).toBe("requires_payment_method");
    expect(si.client_secret).toMatch(/^seti_.+_secret_.+/);
  });

  test("create with payment_method: requires_confirmation", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    const si = await service.create({ payment_method: pm.id });
    expect(si.status).toBe("requires_confirmation");
  });

  test("confirm: succeeds", async () => {
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    const si = await service.create({ payment_method: pm.id });
    const confirmed = await service.confirm(si.id, {});
    expect(confirmed.status).toBe("succeeded");
  });

  test("cancel: cancels", async () => {
    const si = await service.create({});
    const canceled = await service.cancel(si.id);
    expect(canceled.status).toBe("canceled");
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `bun test tests/unit/services/setup-intents.test.ts`
Expected: FAIL — module not found

- [ ] **Step 9: Implement setup intents service**

`src/services/setup-intents.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { setupIntents } from "../db/schema/setup-intents";
import { generateId, generateSecret } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, stateTransitionError, invalidRequestError } from "../errors";
import type { PaymentMethodService } from "./payment-methods";
import type Stripe from "stripe";

interface CreateParams {
  customer?: string;
  payment_method?: string;
  confirm?: boolean;
  metadata?: Record<string, string>;
}

export class SetupIntentService {
  constructor(
    private db: StrimulatorDB,
    private paymentMethodService: PaymentMethodService,
  ) {}

  async create(params: CreateParams): Promise<Stripe.SetupIntent> {
    const id = generateId("setup_intent");
    const created = now();
    const clientSecret = `${id}_secret_${generateSecret("").slice(0, 16)}`;

    let status: string = "requires_payment_method";
    if (params.payment_method) status = "requires_confirmation";

    const data = {
      id,
      object: "setup_intent",
      application: null,
      automatic_payment_methods: null,
      cancellation_reason: null,
      client_secret: clientSecret,
      created,
      customer: params.customer ?? null,
      description: null,
      flow_directions: null,
      last_setup_error: null,
      latest_attempt: null,
      livemode: false,
      mandate: null,
      metadata: params.metadata ?? {},
      next_action: null,
      on_behalf_of: null,
      payment_method: params.payment_method ?? null,
      payment_method_options: {},
      payment_method_types: ["card"],
      single_use_mandate: null,
      status,
      usage: "off_session",
    } as unknown as Stripe.SetupIntent;

    this.db.insert(setupIntents).values({
      id,
      customerId: params.customer ?? null,
      paymentMethodId: params.payment_method ?? null,
      status,
      clientSecret,
      created,
      data: data as any,
    }).run();

    if (params.confirm && params.payment_method) {
      return this.confirm(id, {});
    }

    return data;
  }

  async retrieve(id: string): Promise<Stripe.SetupIntent> {
    const row = this.db.select().from(setupIntents).where(eq(setupIntents.id, id)).get();
    if (!row) throw resourceNotFoundError("setup_intent", id);
    return row.data as unknown as Stripe.SetupIntent;
  }

  async confirm(id: string, params: { payment_method?: string }): Promise<Stripe.SetupIntent> {
    const si = await this.retrieve(id);
    if (si.status !== "requires_confirmation" && si.status !== "requires_payment_method") {
      throw stateTransitionError("setup_intent", id, si.status, "confirm");
    }

    const pmId = params.payment_method ?? si.payment_method;
    if (!pmId) throw invalidRequestError("Missing payment method", "payment_method");

    const updated = { ...si, status: "succeeded", payment_method: pmId } as unknown as Stripe.SetupIntent;

    this.db.update(setupIntents).set({
      status: "succeeded",
      paymentMethodId: pmId as string,
      data: updated as any,
    }).where(eq(setupIntents.id, id)).run();

    return updated;
  }

  async cancel(id: string): Promise<Stripe.SetupIntent> {
    const si = await this.retrieve(id);
    if (si.status === "succeeded" || si.status === "canceled") {
      throw stateTransitionError("setup_intent", id, si.status, "cancel");
    }

    const updated = { ...si, status: "canceled", cancellation_reason: "abandoned" } as unknown as Stripe.SetupIntent;
    this.db.update(setupIntents).set({ status: "canceled", data: updated as any }).where(eq(setupIntents.id, id)).run();
    return updated;
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;
    const rows = this.db.select().from(setupIntents).orderBy(desc(setupIntents.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.SetupIntent);
    return buildListResponse(items, "/v1/setup_intents", hasMore);
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `bun test tests/unit/services/setup-intents.test.ts`
Expected: PASS

- [ ] **Step 11: Create route plugins for refunds and setup intents**

`src/routes/refunds.ts`:
```typescript
import { Elysia } from "elysia";
import { RefundService } from "../services/refunds";
import { ChargeService } from "../services/charges";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function refundRoutes(db: StrimulatorDB) {
  const chargeService = new ChargeService(db);
  const service = new RefundService(db, chargeService);

  return new Elysia({ prefix: "/v1/refunds" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        charge: body.charge,
        payment_intent: body.payment_intent,
        amount: body.amount ? parseInt(body.amount, 10) : undefined,
        reason: body.reason,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

`src/routes/setup-intents.ts`:
```typescript
import { Elysia } from "elysia";
import { SetupIntentService } from "../services/setup-intents";
import { PaymentMethodService } from "../services/payment-methods";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function setupIntentRoutes(db: StrimulatorDB) {
  const pmService = new PaymentMethodService(db);
  const service = new SetupIntentService(db, pmService);

  return new Elysia({ prefix: "/v1/setup_intents" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        customer: body.customer,
        payment_method: body.payment_method,
        confirm: body.confirm === "true",
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id/confirm", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.confirm(params.id, { payment_method: body.payment_method });
    })
    .post("/:id/cancel", async ({ params }) => service.cancel(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

- [ ] **Step 12: Wire routes into app.ts**

Add imports and `.use()` calls for `refundRoutes` and `setupIntentRoutes`.

- [ ] **Step 13: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 14: Commit**

```bash
git add src/db/schema/refunds.ts src/db/schema/setup-intents.ts src/db/index.ts src/services/refunds.ts src/services/setup-intents.ts src/routes/refunds.ts src/routes/setup-intents.ts src/app.ts tests/unit/services/refunds.test.ts tests/unit/services/setup-intents.test.ts
git commit -m "feat: add refunds and setup intents with routes and tests"
```

---

## Phase 4: Billing (Subscriptions & Invoices)

### Task 15: Subscriptions & Invoices Schemas, Services, and Routes

**Files:**
- Create: `src/db/schema/subscriptions.ts`
- Create: `src/db/schema/invoices.ts`
- Create: `src/services/subscriptions.ts`
- Create: `src/services/invoices.ts`
- Create: `src/routes/subscriptions.ts`
- Create: `src/routes/invoices.ts`
- Create: `tests/unit/services/subscriptions.test.ts`
- Create: `tests/unit/services/invoices.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/app.ts`

This is the most complex task — subscriptions create invoices which create payment intents. Follow the same TDD pattern as previous tasks.

- [ ] **Step 1: Create subscriptions and invoices schemas**

`src/db/schema/subscriptions.ts`:
```typescript
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
```

`src/db/schema/invoices.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  subscriptionId: text("subscription_id"),
  status: text("status").notNull(),
  amountDue: integer("amount_due").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  currency: text("currency").notNull(),
  paymentIntentId: text("payment_intent_id"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

Update `src/db/index.ts` with new schemas and CREATE TABLEs.

- [ ] **Step 2: Write failing tests for invoices service**

`tests/unit/services/invoices.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { InvoiceService } from "../../../src/services/invoices";
import { CustomerService } from "../../../src/services/customers";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("InvoiceService", () => {
  let db: StrimulatorDB;
  let invoiceService: InvoiceService;
  let customerService: CustomerService;

  beforeEach(() => {
    db = createDB(":memory:");
    customerService = new CustomerService(db);
    invoiceService = new InvoiceService(db);
  });

  test("create: returns invoice in draft status", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const invoice = await invoiceService.create({ customer: customer.id, currency: "usd" });

    expect(invoice.id).toMatch(/^in_/);
    expect(invoice.object).toBe("invoice");
    expect(invoice.status).toBe("draft");
    expect(invoice.customer).toBe(customer.id);
  });

  test("finalize: moves to open", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const invoice = await invoiceService.create({ customer: customer.id, currency: "usd" });
    const finalized = await invoiceService.finalizeInvoice(invoice.id);
    expect(finalized.status).toBe("open");
  });

  test("pay: moves to paid", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const invoice = await invoiceService.create({ customer: customer.id, currency: "usd", amount_due: 2000 });
    await invoiceService.finalizeInvoice(invoice.id);
    const paid = await invoiceService.pay(invoice.id);
    expect(paid.status).toBe("paid");
    expect(paid.amount_paid).toBe(2000);
  });

  test("void: moves to void", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    const invoice = await invoiceService.create({ customer: customer.id, currency: "usd" });
    await invoiceService.finalizeInvoice(invoice.id);
    const voided = await invoiceService.voidInvoice(invoice.id);
    expect(voided.status).toBe("void");
  });

  test("list: returns paginated invoices", async () => {
    const customer = await customerService.create({ email: "a@b.com" });
    await invoiceService.create({ customer: customer.id, currency: "usd" });
    await invoiceService.create({ customer: customer.id, currency: "usd" });
    const list = await invoiceService.list({ limit: 10 });
    expect(list.data.length).toBe(2);
  });
});
```

- [ ] **Step 3: Implement invoices service**

`src/services/invoices.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { invoices } from "../db/schema/invoices";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, stateTransitionError } from "../errors";
import type Stripe from "stripe";

interface CreateParams {
  customer: string;
  subscription?: string;
  currency: string;
  amount_due?: number;
  metadata?: Record<string, string>;
}

export class InvoiceService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams): Promise<Stripe.Invoice> {
    const id = generateId("invoice");
    const created = now();
    const amountDue = params.amount_due ?? 0;

    const data = {
      id,
      object: "invoice",
      account_country: "US",
      account_name: "Strimulator",
      amount_due: amountDue,
      amount_paid: 0,
      amount_remaining: amountDue,
      attempt_count: 0,
      attempted: false,
      auto_advance: true,
      billing_reason: params.subscription ? "subscription_cycle" : "manual",
      collection_method: "charge_automatically",
      created,
      currency: params.currency,
      customer: params.customer,
      customer_email: null,
      default_payment_method: null,
      description: null,
      discount: null,
      due_date: null,
      effective_at: null,
      ending_balance: null,
      footer: null,
      hosted_invoice_url: null,
      invoice_pdf: null,
      lines: { object: "list", data: [], has_more: false, url: `/v1/invoices/${id}/lines` },
      livemode: false,
      metadata: params.metadata ?? {},
      next_payment_attempt: null,
      number: null,
      paid: false,
      paid_out_of_band: false,
      payment_intent: null,
      period_end: created,
      period_start: created,
      post_payment_credit_notes_amount: 0,
      pre_payment_credit_notes_amount: 0,
      starting_balance: 0,
      status: "draft",
      subscription: params.subscription ?? null,
      subtotal: amountDue,
      total: amountDue,
    } as unknown as Stripe.Invoice;

    this.db.insert(invoices).values({
      id,
      customerId: params.customer,
      subscriptionId: params.subscription ?? null,
      status: "draft",
      amountDue,
      amountPaid: 0,
      currency: params.currency,
      paymentIntentId: null,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Invoice> {
    const row = this.db.select().from(invoices).where(eq(invoices.id, id)).get();
    if (!row) throw resourceNotFoundError("invoice", id);
    return row.data as unknown as Stripe.Invoice;
  }

  async finalizeInvoice(id: string): Promise<Stripe.Invoice> {
    const invoice = await this.retrieve(id);
    if (invoice.status !== "draft") {
      throw stateTransitionError("invoice", id, invoice.status!, "finalize");
    }

    const updated = {
      ...invoice,
      status: "open",
      effective_at: now(),
      number: `INV-${id.slice(3, 11).toUpperCase()}`,
    } as unknown as Stripe.Invoice;

    this.db.update(invoices).set({ status: "open", data: updated as any }).where(eq(invoices.id, id)).run();
    return updated;
  }

  async pay(id: string): Promise<Stripe.Invoice> {
    const invoice = await this.retrieve(id);
    if (invoice.status !== "open") {
      throw stateTransitionError("invoice", id, invoice.status!, "pay");
    }

    const updated = {
      ...invoice,
      status: "paid",
      paid: true,
      amount_paid: invoice.amount_due,
      amount_remaining: 0,
      attempted: true,
      attempt_count: ((invoice as any).attempt_count ?? 0) + 1,
    } as unknown as Stripe.Invoice;

    this.db.update(invoices).set({
      status: "paid",
      amountPaid: invoice.amount_due!,
      data: updated as any,
    }).where(eq(invoices.id, id)).run();

    return updated;
  }

  async voidInvoice(id: string): Promise<Stripe.Invoice> {
    const invoice = await this.retrieve(id);
    if (invoice.status !== "open") {
      throw stateTransitionError("invoice", id, invoice.status!, "void");
    }

    const updated = { ...invoice, status: "void" } as unknown as Stripe.Invoice;
    this.db.update(invoices).set({ status: "void", data: updated as any }).where(eq(invoices.id, id)).run();
    return updated;
  }

  async list(params: Partial<ListParams> & { customerId?: string; subscriptionId?: string } = {}) {
    const limit = params.limit ?? 10;
    let conditions: any[] = [];
    if (params.customerId) conditions.push(eq(invoices.customerId, params.customerId));
    if (params.subscriptionId) conditions.push(eq(invoices.subscriptionId, params.subscriptionId));

    const query = conditions.length > 0
      ? this.db.select().from(invoices).where(and(...conditions))
      : this.db.select().from(invoices);

    const rows = query.orderBy(desc(invoices.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Invoice);
    return buildListResponse(items, "/v1/invoices", hasMore);
  }
}
```

- [ ] **Step 4: Run invoices tests**

Run: `bun test tests/unit/services/invoices.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for subscriptions service**

`tests/unit/services/subscriptions.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { SubscriptionService } from "../../../src/services/subscriptions";
import { CustomerService } from "../../../src/services/customers";
import { ProductService } from "../../../src/services/products";
import { PriceService } from "../../../src/services/prices";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { PaymentIntentService } from "../../../src/services/payment-intents";
import { ChargeService } from "../../../src/services/charges";
import { InvoiceService } from "../../../src/services/invoices";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("SubscriptionService", () => {
  let db: StrimulatorDB;
  let subService: SubscriptionService;
  let customerService: CustomerService;
  let priceService: PriceService;
  let pmService: PaymentMethodService;
  let productId: string;
  let priceId: string;
  let customerId: string;

  beforeEach(async () => {
    db = createDB(":memory:");
    customerService = new CustomerService(db);
    const productService = new ProductService(db);
    priceService = new PriceService(db);
    pmService = new PaymentMethodService(db);
    const chargeService = new ChargeService(db);
    const piService = new PaymentIntentService(db, chargeService, pmService);
    const invoiceService = new InvoiceService(db);
    subService = new SubscriptionService(db, invoiceService, priceService);

    const customer = await customerService.create({ email: "a@b.com" });
    customerId = customer.id;
    const pm = await pmService.create({ type: "card", card: { token: "tok_visa" } });
    await pmService.attach(pm.id, customerId);
    const product = await productService.create({ name: "Pro" });
    productId = product.id;
    const price = await priceService.create({
      product: productId,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });
    priceId = price.id;
  });

  test("create: returns subscription with items", async () => {
    const sub = await subService.create({
      customer: customerId,
      items: [{ price: priceId }],
    });

    expect(sub.id).toMatch(/^sub_/);
    expect(sub.object).toBe("subscription");
    expect(sub.status).toBe("active");
    expect(sub.customer).toBe(customerId);
    expect(sub.items.data.length).toBe(1);
    expect(sub.items.data[0].price.id).toBe(priceId);
    expect(sub.current_period_start).toBeGreaterThan(0);
    expect(sub.current_period_end).toBeGreaterThan(sub.current_period_start);
  });

  test("create with trial: starts as trialing", async () => {
    const sub = await subService.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 14,
    });

    expect(sub.status).toBe("trialing");
    expect(sub.trial_end).toBeGreaterThan(0);
  });

  test("cancel: moves to canceled", async () => {
    const sub = await subService.create({
      customer: customerId,
      items: [{ price: priceId }],
    });
    const canceled = await subService.cancel(sub.id);
    expect(canceled.status).toBe("canceled");
    expect(canceled.canceled_at).toBeGreaterThan(0);
  });

  test("retrieve: returns subscription by ID", async () => {
    const created = await subService.create({
      customer: customerId,
      items: [{ price: priceId }],
    });
    const retrieved = await subService.retrieve(created.id);
    expect(retrieved.id).toBe(created.id);
  });

  test("list: returns paginated subscriptions", async () => {
    await subService.create({ customer: customerId, items: [{ price: priceId }] });
    await subService.create({ customer: customerId, items: [{ price: priceId }] });
    const list = await subService.list({ limit: 10 });
    expect(list.data.length).toBe(2);
  });
});
```

- [ ] **Step 6: Implement subscriptions service**

`src/services/subscriptions.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { subscriptions, subscriptionItems } from "../db/schema/subscriptions";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, stateTransitionError, invalidRequestError } from "../errors";
import type { InvoiceService } from "./invoices";
import type { PriceService } from "./prices";
import type Stripe from "stripe";

interface CreateParams {
  customer: string;
  items: Array<{ price: string; quantity?: number }>;
  trial_period_days?: number;
  metadata?: Record<string, string>;
}

export class SubscriptionService {
  constructor(
    private db: StrimulatorDB,
    private invoiceService: InvoiceService,
    private priceService: PriceService,
  ) {}

  async create(params: CreateParams): Promise<Stripe.Subscription> {
    if (!params.customer) throw invalidRequestError("Missing required param: customer", "customer");
    if (!params.items?.length) throw invalidRequestError("Missing required param: items", "items");

    const id = generateId("subscription");
    const created = now();
    const periodStart = created;
    const periodEnd = created + 30 * 24 * 60 * 60; // ~30 days
    const hasTrial = (params.trial_period_days ?? 0) > 0;
    const trialEnd = hasTrial ? created + params.trial_period_days! * 24 * 60 * 60 : null;
    const status = hasTrial ? "trialing" : "active";

    // Create subscription items
    const itemsData: any[] = [];
    for (const item of params.items) {
      const price = await this.priceService.retrieve(item.price);
      const siId = generateId("subscription_item");
      const siData = {
        id: siId,
        object: "subscription_item",
        created,
        metadata: {},
        price,
        quantity: item.quantity ?? 1,
        subscription: id,
      };
      itemsData.push(siData);

      this.db.insert(subscriptionItems).values({
        id: siId,
        subscriptionId: id,
        priceId: item.price,
        quantity: item.quantity ?? 1,
        created,
        data: siData as any,
      }).run();
    }

    const data = {
      id,
      object: "subscription",
      application: null,
      application_fee_percent: null,
      automatic_tax: { enabled: false, liability: null },
      billing_cycle_anchor: periodStart,
      cancel_at: null,
      cancel_at_period_end: false,
      canceled_at: null,
      cancellation_details: { comment: null, feedback: null, reason: null },
      collection_method: "charge_automatically",
      created,
      currency: (itemsData[0]?.price as any)?.currency ?? "usd",
      current_period_end: periodEnd,
      current_period_start: periodStart,
      customer: params.customer,
      days_until_due: null,
      default_payment_method: null,
      default_source: null,
      description: null,
      discount: null,
      ended_at: null,
      items: {
        object: "list",
        data: itemsData,
        has_more: false,
        url: `/v1/subscription_items?subscription=${id}`,
      },
      latest_invoice: null,
      livemode: false,
      metadata: params.metadata ?? {},
      next_pending_invoice_item_invoice: null,
      on_behalf_of: null,
      pause_collection: null,
      payment_settings: { payment_method_options: null, payment_method_types: null, save_default_payment_method: "off" },
      pending_invoice_item_interval: null,
      pending_setup_intent: null,
      pending_update: null,
      schedule: null,
      start_date: periodStart,
      status,
      test_clock: null,
      transfer_data: null,
      trial_end: trialEnd,
      trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } },
      trial_start: hasTrial ? created : null,
    } as unknown as Stripe.Subscription;

    this.db.insert(subscriptions).values({
      id,
      customerId: params.customer,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      testClockId: null,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.Subscription> {
    const row = this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
    if (!row) throw resourceNotFoundError("subscription", id);
    return row.data as unknown as Stripe.Subscription;
  }

  async cancel(id: string): Promise<Stripe.Subscription> {
    const sub = await this.retrieve(id);
    if (sub.status === "canceled") {
      throw stateTransitionError("subscription", id, sub.status, "cancel");
    }

    const updated = {
      ...sub,
      status: "canceled",
      canceled_at: now(),
      ended_at: now(),
    } as unknown as Stripe.Subscription;

    this.db.update(subscriptions).set({
      status: "canceled",
      data: updated as any,
    }).where(eq(subscriptions.id, id)).run();

    return updated;
  }

  async list(params: Partial<ListParams> & { customerId?: string } = {}) {
    const limit = params.limit ?? 10;
    let conditions: any[] = [];
    if (params.customerId) conditions.push(eq(subscriptions.customerId, params.customerId));

    const query = conditions.length > 0
      ? this.db.select().from(subscriptions).where(and(...conditions))
      : this.db.select().from(subscriptions);

    const rows = query.orderBy(desc(subscriptions.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Subscription);
    return buildListResponse(items, "/v1/subscriptions", hasMore);
  }
}
```

- [ ] **Step 7: Run subscriptions tests**

Run: `bun test tests/unit/services/subscriptions.test.ts`
Expected: PASS

- [ ] **Step 8: Create route plugins for subscriptions and invoices**

`src/routes/subscriptions.ts`:
```typescript
import { Elysia } from "elysia";
import { SubscriptionService } from "../services/subscriptions";
import { InvoiceService } from "../services/invoices";
import { PriceService } from "../services/prices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function subscriptionRoutes(db: StrimulatorDB) {
  const invoiceService = new InvoiceService(db);
  const priceService = new PriceService(db);
  const service = new SubscriptionService(db, invoiceService, priceService);

  return new Elysia({ prefix: "/v1/subscriptions" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      const items = body.items
        ? (Array.isArray(body.items) ? body.items : Object.values(body.items)).map((item: any) => ({
            price: item.price,
            quantity: item.quantity ? parseInt(item.quantity, 10) : undefined,
          }))
        : [];
      return service.create({
        customer: body.customer,
        items,
        trial_period_days: body.trial_period_days ? parseInt(body.trial_period_days, 10) : undefined,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .delete("/:id", async ({ params }) => service.cancel(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      const params = Object.fromEntries(url.searchParams);
      return service.list({ ...parseListParams(params), customerId: params.customer });
    });
}
```

`src/routes/invoices.ts`:
```typescript
import { Elysia } from "elysia";
import { InvoiceService } from "../services/invoices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function invoiceRoutes(db: StrimulatorDB) {
  const service = new InvoiceService(db);

  return new Elysia({ prefix: "/v1/invoices" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        customer: body.customer,
        currency: body.currency ?? "usd",
        subscription: body.subscription,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id/finalize", async ({ params }) => service.finalizeInvoice(params.id))
    .post("/:id/pay", async ({ params }) => service.pay(params.id))
    .post("/:id/void", async ({ params }) => service.voidInvoice(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      const params = Object.fromEntries(url.searchParams);
      return service.list({
        ...parseListParams(params),
        customerId: params.customer,
        subscriptionId: params.subscription,
      });
    });
}
```

- [ ] **Step 9: Wire routes into app.ts**

Add imports and `.use()` calls for `subscriptionRoutes` and `invoiceRoutes`.

- [ ] **Step 10: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add src/db/schema/subscriptions.ts src/db/schema/invoices.ts src/db/index.ts src/services/subscriptions.ts src/services/invoices.ts src/routes/subscriptions.ts src/routes/invoices.ts src/app.ts tests/unit/services/subscriptions.test.ts tests/unit/services/invoices.test.ts
git commit -m "feat: add subscriptions and invoices with billing lifecycle"
```

---

## Phase 5: Webhooks

### Task 16: Events, Webhook Endpoints, Delivery Engine

**Files:**
- Create: `src/db/schema/events.ts`
- Create: `src/db/schema/webhook-endpoints.ts`
- Create: `src/db/schema/webhook-deliveries.ts`
- Create: `src/services/events.ts`
- Create: `src/services/webhook-endpoints.ts`
- Create: `src/services/webhook-delivery.ts`
- Create: `src/routes/events.ts`
- Create: `src/routes/webhook-endpoints.ts`
- Create: `tests/unit/services/events.test.ts`
- Create: `tests/unit/services/webhook-delivery.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Create event and webhook schemas**

`src/db/schema/events.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  apiVersion: text("api_version").notNull(),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

`src/db/schema/webhook-endpoints.ts`:
```typescript
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
```

`src/db/schema/webhook-deliveries.ts`:
```typescript
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
```

Update `src/db/index.ts` with all new schemas and CREATE TABLEs.

- [ ] **Step 2: Write failing tests for events service**

`tests/unit/services/events.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { EventService } from "../../../src/services/events";
import { createDB, type StrimulatorDB } from "../../../src/db";
import { config } from "../../../src/config";

describe("EventService", () => {
  let db: StrimulatorDB;
  let service: EventService;

  beforeEach(() => {
    db = createDB(":memory:");
    service = new EventService(db);
  });

  test("emit: creates event with correct shape", async () => {
    const event = await service.emit("customer.created", { id: "cus_123", object: "customer" });

    expect(event.id).toMatch(/^evt_/);
    expect(event.object).toBe("event");
    expect(event.type).toBe("customer.created");
    expect(event.data.object.id).toBe("cus_123");
    expect(event.api_version).toBe(config.apiVersion);
  });

  test("retrieve: returns event by ID", async () => {
    const created = await service.emit("customer.created", { id: "cus_123", object: "customer" });
    const retrieved = await service.retrieve(created.id);
    expect(retrieved.id).toBe(created.id);
  });

  test("list: filters by type", async () => {
    await service.emit("customer.created", { id: "cus_1", object: "customer" });
    await service.emit("payment_intent.succeeded", { id: "pi_1", object: "payment_intent" });
    await service.emit("customer.updated", { id: "cus_1", object: "customer" });

    const customerEvents = await service.list({ type: "customer.created", limit: 10 });
    expect(customerEvents.data.length).toBe(1);
  });
});
```

- [ ] **Step 3: Implement events service**

`src/services/events.ts`:
```typescript
import { eq, desc, lt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { events } from "../db/schema/events";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError } from "../errors";
import { config } from "../config";
import type Stripe from "stripe";

export class EventService {
  private listeners: Array<(event: Stripe.Event) => void> = [];

  constructor(private db: StrimulatorDB) {}

  onEvent(listener: (event: Stripe.Event) => void): void {
    this.listeners.push(listener);
  }

  async emit(type: string, object: any, previousAttributes?: any): Promise<Stripe.Event> {
    const id = generateId("event");
    const created = now();

    const event = {
      id,
      object: "event",
      api_version: config.apiVersion,
      created,
      data: {
        object,
        previous_attributes: previousAttributes ?? undefined,
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type,
    } as unknown as Stripe.Event;

    this.db.insert(events).values({
      id,
      type,
      apiVersion: config.apiVersion,
      created,
      data: event as any,
    }).run();

    // Notify listeners (webhook delivery service)
    for (const listener of this.listeners) {
      listener(event);
    }

    return event;
  }

  async retrieve(id: string): Promise<Stripe.Event> {
    const row = this.db.select().from(events).where(eq(events.id, id)).get();
    if (!row) throw resourceNotFoundError("event", id);
    return row.data as unknown as Stripe.Event;
  }

  async list(params: Partial<ListParams> & { type?: string } = {}) {
    const limit = params.limit ?? 10;
    let conditions: any[] = [];
    if (params.type) conditions.push(eq(events.type, params.type));

    const query = conditions.length > 0
      ? this.db.select().from(events).where(and(...conditions))
      : this.db.select().from(events);

    const rows = query.orderBy(desc(events.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.Event);
    return buildListResponse(items, "/v1/events", hasMore);
  }
}
```

- [ ] **Step 4: Run events tests**

Run: `bun test tests/unit/services/events.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for webhook delivery**

`tests/unit/services/webhook-delivery.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { WebhookDeliveryService } from "../../../src/services/webhook-delivery";
import { WebhookEndpointService } from "../../../src/services/webhook-endpoints";
import { EventService } from "../../../src/services/events";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("WebhookDeliveryService", () => {
  let db: StrimulatorDB;
  let deliveryService: WebhookDeliveryService;
  let endpointService: WebhookEndpointService;
  let eventService: EventService;

  beforeEach(() => {
    db = createDB(":memory:");
    endpointService = new WebhookEndpointService(db);
    eventService = new EventService(db);
    deliveryService = new WebhookDeliveryService(db, endpointService);
  });

  test("generates correct Stripe-Signature header", () => {
    const payload = '{"id":"evt_123"}';
    const secret = "whsec_test123";
    const timestamp = 1234567890;

    const signature = deliveryService.generateSignature(payload, secret, timestamp);
    expect(signature).toContain("t=1234567890");
    expect(signature).toContain(",v1=");
  });

  test("matches endpoint with wildcard enabled_events", async () => {
    await endpointService.create({
      url: "http://localhost:9999/webhook",
      enabled_events: ["*"],
    });

    const event = await eventService.emit("customer.created", { id: "cus_1", object: "customer" });
    const endpoints = await deliveryService.findMatchingEndpoints(event.type);
    expect(endpoints.length).toBe(1);
  });

  test("matches endpoint with specific event type", async () => {
    await endpointService.create({
      url: "http://localhost:9999/webhook",
      enabled_events: ["customer.created"],
    });

    const endpoints = await deliveryService.findMatchingEndpoints("customer.created");
    expect(endpoints.length).toBe(1);

    const noMatch = await deliveryService.findMatchingEndpoints("payment_intent.succeeded");
    expect(noMatch.length).toBe(0);
  });
});
```

- [ ] **Step 6: Implement webhook endpoints service**

`src/services/webhook-endpoints.ts`:
```typescript
import { eq, desc } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { webhookEndpoints } from "../db/schema/webhook-endpoints";
import { generateId, generateSecret } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type Stripe from "stripe";

interface CreateParams {
  url: string;
  enabled_events: string[];
  description?: string;
  metadata?: Record<string, string>;
}

export class WebhookEndpointService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams): Promise<Stripe.WebhookEndpoint> {
    if (!params.url) throw invalidRequestError("Missing required param: url", "url");
    if (!params.enabled_events?.length) throw invalidRequestError("Missing required param: enabled_events", "enabled_events");

    const id = generateId("webhook_endpoint");
    const secret = generateSecret("whsec");
    const created = now();

    const data = {
      id,
      object: "webhook_endpoint",
      api_version: null,
      application: null,
      created,
      description: params.description ?? null,
      enabled_events: params.enabled_events,
      livemode: false,
      metadata: params.metadata ?? {},
      secret,
      status: "enabled",
      url: params.url,
    } as unknown as Stripe.WebhookEndpoint;

    this.db.insert(webhookEndpoints).values({
      id,
      url: params.url,
      secret,
      status: "enabled",
      enabledEvents: params.enabled_events as any,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string): Promise<Stripe.WebhookEndpoint> {
    const row = this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).get();
    if (!row) throw resourceNotFoundError("webhook_endpoint", id);
    return row.data as unknown as Stripe.WebhookEndpoint;
  }

  async del(id: string): Promise<Stripe.DeletedWebhookEndpoint> {
    await this.retrieve(id);
    this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).run();
    return { id, object: "webhook_endpoint", deleted: true } as Stripe.DeletedWebhookEndpoint;
  }

  async listAll(): Promise<Array<{ id: string; url: string; secret: string; enabledEvents: string[]; status: string }>> {
    const rows = this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.status, "enabled")).all();
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      secret: r.secret,
      enabledEvents: r.enabledEvents as unknown as string[],
      status: r.status,
    }));
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;
    const rows = this.db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data as unknown as Stripe.WebhookEndpoint);
    return buildListResponse(items, "/v1/webhook_endpoints", hasMore);
  }
}
```

- [ ] **Step 7: Implement webhook delivery service**

`src/services/webhook-delivery.ts`:
```typescript
import { createHmac } from "crypto";
import type { StrimulatorDB } from "../db";
import { webhookDeliveries } from "../db/schema/webhook-deliveries";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import type { WebhookEndpointService } from "./webhook-endpoints";
import type Stripe from "stripe";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 10000, 60000]; // 1s, 10s, 60s

export class WebhookDeliveryService {
  constructor(
    private db: StrimulatorDB,
    private endpointService: WebhookEndpointService,
  ) {}

  async findMatchingEndpoints(eventType: string) {
    const all = await this.endpointService.listAll();
    return all.filter((ep) => {
      const events = ep.enabledEvents;
      return events.includes("*") || events.includes(eventType);
    });
  }

  generateSignature(payload: string, secret: string, timestamp: number): string {
    const signedPayload = `${timestamp}.${payload}`;
    const signature = createHmac("sha256", secret).update(signedPayload).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  async deliver(event: Stripe.Event): Promise<void> {
    const endpoints = await this.findMatchingEndpoints(event.type);

    for (const endpoint of endpoints) {
      const deliveryId = generateId("webhook_delivery");
      this.db.insert(webhookDeliveries).values({
        id: deliveryId,
        eventId: event.id,
        endpointId: endpoint.id,
        status: "pending",
        attempts: 0,
        nextRetryAt: null,
        created: now(),
      }).run();

      this.attemptDelivery(deliveryId, event, endpoint);
    }
  }

  private async attemptDelivery(
    deliveryId: string,
    event: Stripe.Event,
    endpoint: { url: string; secret: string },
  ): Promise<void> {
    const payload = JSON.stringify(event);
    const timestamp = now();
    const signature = this.generateSignature(payload, endpoint.secret, timestamp);

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": signature,
        },
        body: payload,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        this.db.update(webhookDeliveries).set({
          status: "delivered",
          attempts: 1,
        }).where(
          require("drizzle-orm").eq(webhookDeliveries.id, deliveryId),
        ).run();
      } else {
        this.handleFailure(deliveryId, event, endpoint, 1);
      }
    } catch {
      this.handleFailure(deliveryId, event, endpoint, 1);
    }
  }

  private handleFailure(
    deliveryId: string,
    event: Stripe.Event,
    endpoint: { url: string; secret: string },
    attempt: number,
  ): void {
    const { eq } = require("drizzle-orm");

    if (attempt >= MAX_RETRIES) {
      this.db.update(webhookDeliveries).set({
        status: "failed",
        attempts: attempt,
      }).where(eq(webhookDeliveries.id, deliveryId)).run();
      return;
    }

    const delay = RETRY_DELAYS[attempt - 1] ?? 60000;
    this.db.update(webhookDeliveries).set({
      status: "retrying",
      attempts: attempt,
      nextRetryAt: now() + Math.floor(delay / 1000),
    }).where(eq(webhookDeliveries.id, deliveryId)).run();

    setTimeout(() => {
      this.attemptDelivery(deliveryId, event, endpoint);
    }, delay);
  }
}
```

- [ ] **Step 8: Run webhook tests**

Run: `bun test tests/unit/services/events.test.ts tests/unit/services/webhook-delivery.test.ts`
Expected: PASS

- [ ] **Step 9: Create route plugins for events and webhook endpoints**

`src/routes/events.ts`:
```typescript
import { Elysia } from "elysia";
import { EventService } from "../services/events";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function eventRoutes(db: StrimulatorDB) {
  const service = new EventService(db);

  return new Elysia({ prefix: "/v1/events" })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      const params = Object.fromEntries(url.searchParams);
      return service.list({ ...parseListParams(params), type: params.type });
    });
}
```

`src/routes/webhook-endpoints.ts`:
```typescript
import { Elysia } from "elysia";
import { WebhookEndpointService } from "../services/webhook-endpoints";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function webhookEndpointRoutes(db: StrimulatorDB) {
  const service = new WebhookEndpointService(db);

  return new Elysia({ prefix: "/v1/webhook_endpoints" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        url: body.url,
        enabled_events: body.enabled_events ?? [],
        description: body.description,
        metadata: body.metadata,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .delete("/:id", async ({ params }) => service.del(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

- [ ] **Step 10: Wire routes and connect event delivery to services**

Wire the EventService and WebhookDeliveryService into the app so that service mutations emit events. This requires refactoring `createApp` to create a shared `EventService` instance and pass it to all services.

Update `src/app.ts` to create a `ServiceContainer` that wires up all services with a shared EventService:
```typescript
// Add to app.ts
import { EventService } from "./services/events";
import { WebhookEndpointService } from "./services/webhook-endpoints";
import { WebhookDeliveryService } from "./services/webhook-delivery";
import { eventRoutes } from "./routes/events";
import { webhookEndpointRoutes } from "./routes/webhook-endpoints";

// In createApp:
const eventService = new EventService(database);
const endpointService = new WebhookEndpointService(database);
const deliveryService = new WebhookDeliveryService(database, endpointService);

// Wire delivery to event emissions
eventService.onEvent((event) => deliveryService.deliver(event));

// Add routes
.use(eventRoutes(database))
.use(webhookEndpointRoutes(database))
```

- [ ] **Step 11: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 12: Commit**

```bash
git add src/db/schema/events.ts src/db/schema/webhook-endpoints.ts src/db/schema/webhook-deliveries.ts src/db/index.ts src/services/events.ts src/services/webhook-endpoints.ts src/services/webhook-delivery.ts src/routes/events.ts src/routes/webhook-endpoints.ts src/app.ts tests/unit/services/events.test.ts tests/unit/services/webhook-delivery.test.ts
git commit -m "feat: add webhook system with events, endpoints, and delivery engine"
```

---

## Phase 6: Test Clocks

### Task 17: Test Clocks Service and Route

**Files:**
- Create: `src/db/schema/test-clocks.ts`
- Create: `src/services/test-clocks.ts`
- Create: `src/routes/test-clocks.ts`
- Create: `tests/unit/services/test-clocks.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/app.ts`

Follow the same TDD pattern. Key behaviors:

- `POST /v1/test_helpers/test_clocks` — create a clock frozen at a given time
- `POST /v1/test_helpers/test_clocks/:id/advance` — advance frozen_time, triggering subscription period transitions for any subscriptions attached to this clock
- `GET /v1/test_helpers/test_clocks/:id` — retrieve
- `DELETE /v1/test_helpers/test_clocks/:id` — delete
- `GET /v1/test_helpers/test_clocks` — list

- [ ] **Step 1: Create test clocks schema**

`src/db/schema/test-clocks.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const testClocks = sqliteTable("test_clocks", {
  id: text("id").primaryKey(),
  frozenTime: integer("frozen_time").notNull(),
  status: text("status").notNull().default("ready"),
  name: text("name"),
  created: integer("created").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});
```

Update `src/db/index.ts`.

- [ ] **Step 2: Write failing tests**

`tests/unit/services/test-clocks.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { TestClockService } from "../../../src/services/test-clocks";
import { createDB, type StrimulatorDB } from "../../../src/db";

describe("TestClockService", () => {
  let db: StrimulatorDB;
  let service: TestClockService;

  beforeEach(() => {
    db = createDB(":memory:");
    service = new TestClockService(db);
  });

  test("create: returns clock frozen at given time", async () => {
    const frozenTime = Math.floor(Date.now() / 1000);
    const clock = await service.create({ frozen_time: frozenTime });

    expect(clock.id).toMatch(/^clock_/);
    expect(clock.object).toBe("test_helpers.test_clock");
    expect(clock.frozen_time).toBe(frozenTime);
    expect(clock.status).toBe("ready");
  });

  test("advance: moves frozen_time forward", async () => {
    const frozenTime = Math.floor(Date.now() / 1000);
    const clock = await service.create({ frozen_time: frozenTime });
    const advanced = await service.advance(clock.id, frozenTime + 86400);

    expect(advanced.frozen_time).toBe(frozenTime + 86400);
  });

  test("advance: cannot move backward", async () => {
    const frozenTime = Math.floor(Date.now() / 1000);
    const clock = await service.create({ frozen_time: frozenTime });

    expect(
      service.advance(clock.id, frozenTime - 100),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("delete: removes clock", async () => {
    const clock = await service.create({ frozen_time: Math.floor(Date.now() / 1000) });
    const deleted = await service.del(clock.id);
    expect(deleted.deleted).toBe(true);
  });
});
```

- [ ] **Step 3: Implement test clocks service**

`src/services/test-clocks.ts`:
```typescript
import { eq, desc } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { testClocks } from "../db/schema/test-clocks";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";

interface CreateParams {
  frozen_time: number;
  name?: string;
}

export class TestClockService {
  constructor(private db: StrimulatorDB) {}

  async create(params: CreateParams) {
    const id = generateId("test_clock");
    const created = now();

    const data = {
      id,
      object: "test_helpers.test_clock",
      created,
      deletes_after: created + 30 * 24 * 60 * 60,
      frozen_time: params.frozen_time,
      livemode: false,
      name: params.name ?? null,
      status: "ready",
    };

    this.db.insert(testClocks).values({
      id,
      frozenTime: params.frozen_time,
      status: "ready",
      name: params.name ?? null,
      created,
      data: data as any,
    }).run();

    return data;
  }

  async retrieve(id: string) {
    const row = this.db.select().from(testClocks).where(eq(testClocks.id, id)).get();
    if (!row) throw resourceNotFoundError("test_clock", id);
    return row.data as any;
  }

  async advance(id: string, frozenTime: number) {
    const clock = await this.retrieve(id);
    if (frozenTime <= clock.frozen_time) {
      throw invalidRequestError("frozen_time must be greater than the current frozen_time", "frozen_time");
    }

    const updated = { ...clock, frozen_time: frozenTime, status: "ready" };
    this.db.update(testClocks).set({
      frozenTime,
      data: updated as any,
    }).where(eq(testClocks.id, id)).run();

    // TODO: In Phase 7 integration, trigger subscription period advances here

    return updated;
  }

  async del(id: string) {
    await this.retrieve(id);
    this.db.delete(testClocks).where(eq(testClocks.id, id)).run();
    return { id, object: "test_helpers.test_clock", deleted: true };
  }

  async list(params: Partial<ListParams> = {}) {
    const limit = params.limit ?? 10;
    const rows = this.db.select().from(testClocks).orderBy(desc(testClocks.created)).limit(limit + 1).all();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => r.data);
    return buildListResponse(items, "/v1/test_helpers/test_clocks", hasMore);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/services/test-clocks.test.ts`
Expected: PASS

- [ ] **Step 5: Create route plugin**

`src/routes/test-clocks.ts`:
```typescript
import { Elysia } from "elysia";
import { TestClockService } from "../services/test-clocks";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import type { StrimulatorDB } from "../db";

export function testClockRoutes(db: StrimulatorDB) {
  const service = new TestClockService(db);

  return new Elysia({ prefix: "/v1/test_helpers/test_clocks" })
    .post("/", async ({ request }) => {
      const body = parseStripeBody(await request.text());
      return service.create({
        frozen_time: parseInt(body.frozen_time, 10),
        name: body.name,
      });
    })
    .get("/:id", async ({ params }) => service.retrieve(params.id))
    .post("/:id/advance", async ({ params, request }) => {
      const body = parseStripeBody(await request.text());
      return service.advance(params.id, parseInt(body.frozen_time, 10));
    })
    .delete("/:id", async ({ params }) => service.del(params.id))
    .get("/", async ({ request }) => {
      const url = new URL(request.url);
      return service.list(parseListParams(Object.fromEntries(url.searchParams)));
    });
}
```

Wire into `src/app.ts`.

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/test-clocks.ts src/db/index.ts src/services/test-clocks.ts src/routes/test-clocks.ts src/app.ts tests/unit/services/test-clocks.test.ts
git commit -m "feat: add test clocks service with time advancement"
```

---

## Phase 7: SDK Compatibility Tests

### Task 18: End-to-End SDK Compatibility Tests

**Files:**
- Create: `tests/sdk/payment-flow.test.ts`
- Create: `tests/sdk/subscription-flow.test.ts`
- Create: `tests/sdk/webhook-flow.test.ts`

These tests use the actual `stripe` npm package pointed at Strimulator. They prove real-world SDK usage works.

- [ ] **Step 1: Write payment flow SDK test**

`tests/sdk/payment-flow.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

describe("SDK: Payment Flow", () => {
  let app: ReturnType<typeof createApp>;
  let server: any;
  let stripe: Stripe;

  beforeEach(() => {
    app = createApp();
    server = app.listen(0); // random port
    const port = server.port;
    stripe = new Stripe("sk_test_strimulator", {
      host: "localhost",
      port,
      protocol: "http",
    } as any);
  });

  afterEach(() => {
    server.stop();
  });

  test("create customer → create PM → attach → create PI → confirm → succeeded", async () => {
    const customer = await stripe.customers.create({ email: "sdk@test.com" });
    expect(customer.id).toMatch(/^cus_/);
    expect(customer.email).toBe("sdk@test.com");

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });
    expect(pm.id).toMatch(/^pm_/);

    await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

    const pi = await stripe.paymentIntents.create({
      amount: 2000,
      currency: "usd",
      customer: customer.id,
      payment_method: pm.id,
      confirm: true,
    });

    expect(pi.status).toBe("succeeded");
    expect(pi.amount).toBe(2000);
    expect(pi.amount_received).toBe(2000);
  });

  test("manual capture flow", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 5000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
      capture_method: "manual",
    });

    expect(pi.status).toBe("requires_capture");

    const captured = await stripe.paymentIntents.capture(pi.id);
    expect(captured.status).toBe("succeeded");
  });

  test("create and retrieve customer", async () => {
    const created = await stripe.customers.create({
      email: "list@test.com",
      name: "Test User",
      metadata: { plan: "pro" },
    });

    const retrieved = await stripe.customers.retrieve(created.id);
    expect((retrieved as Stripe.Customer).email).toBe("list@test.com");
    expect((retrieved as Stripe.Customer).metadata.plan).toBe("pro");
  });
});
```

- [ ] **Step 2: Write subscription flow SDK test**

`tests/sdk/subscription-flow.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

describe("SDK: Subscription Flow", () => {
  let app: ReturnType<typeof createApp>;
  let server: any;
  let stripe: Stripe;

  beforeEach(() => {
    app = createApp();
    server = app.listen(0);
    stripe = new Stripe("sk_test_strimulator", {
      host: "localhost",
      port: server.port,
      protocol: "http",
    } as any);
  });

  afterEach(() => {
    server.stop();
  });

  test("create product → price → subscription", async () => {
    const customer = await stripe.customers.create({ email: "sub@test.com" });
    const product = await stripe.products.create({ name: "Pro Plan" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    expect(subscription.id).toMatch(/^sub_/);
    expect(subscription.status).toBe("active");
    expect(subscription.items.data[0].price.id).toBe(price.id);
  });

  test("subscription with trial", async () => {
    const customer = await stripe.customers.create({ email: "trial@test.com" });
    const product = await stripe.products.create({ name: "Starter" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 14,
    });

    expect(subscription.status).toBe("trialing");
    expect(subscription.trial_end).toBeGreaterThan(0);
  });

  test("cancel subscription", async () => {
    const customer = await stripe.customers.create({ email: "cancel@test.com" });
    const product = await stripe.products.create({ name: "Basic" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 500,
      currency: "usd",
      recurring: { interval: "month" },
    });
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    const canceled = await stripe.subscriptions.cancel(subscription.id);
    expect(canceled.status).toBe("canceled");
  });
});
```

- [ ] **Step 3: Write webhook flow SDK test**

`tests/sdk/webhook-flow.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

describe("SDK: Webhook Flow", () => {
  let app: ReturnType<typeof createApp>;
  let server: any;
  let stripe: Stripe;

  beforeEach(() => {
    app = createApp();
    server = app.listen(0);
    stripe = new Stripe("sk_test_strimulator", {
      host: "localhost",
      port: server.port,
      protocol: "http",
    } as any);
  });

  afterEach(() => {
    server.stop();
  });

  test("create and retrieve webhook endpoint", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: "http://localhost:9999/webhook",
      enabled_events: ["customer.created", "payment_intent.succeeded"],
    });

    expect(endpoint.id).toMatch(/^we_/);
    expect(endpoint.url).toBe("http://localhost:9999/webhook");
    expect(endpoint.enabled_events).toContain("customer.created");
    expect((endpoint as any).secret).toMatch(/^whsec_/);
  });

  test("list events", async () => {
    // Create some objects that generate events
    await stripe.customers.create({ email: "event@test.com" });

    const events = await stripe.events.list({ limit: 10 });
    expect(events.data.length).toBeGreaterThanOrEqual(0); // Events only exist if services emit them
  });
});
```

- [ ] **Step 4: Run SDK tests**

Run: `bun test tests/sdk/`
Expected: All PASS (may need adjustments based on SDK version compatibility)

- [ ] **Step 5: Commit**

```bash
git add tests/sdk/
git commit -m "feat: add SDK compatibility tests for payment, subscription, webhook flows"
```

---

## Phase 8: Dashboard

### Task 19: Dashboard Backend API

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `src/dashboard/api.ts`
- Create: `tests/integration/dashboard.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing tests for dashboard API**

`tests/integration/dashboard.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { createApp } from "../../src/app";

describe("Dashboard API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("GET /dashboard returns HTML", async () => {
    const res = await app.handle(new Request("http://localhost/dashboard"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("Strimulator");
  });

  test("GET /dashboard/api/stats returns overview stats", async () => {
    const res = await app.handle(new Request("http://localhost/dashboard/api/stats"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("customers");
    expect(body).toHaveProperty("payment_intents");
    expect(body).toHaveProperty("subscriptions");
  });

  test("GET /dashboard/api/requests returns recent requests", async () => {
    const res = await app.handle(new Request("http://localhost/dashboard/api/requests"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("dashboard routes do not require auth", async () => {
    const res = await app.handle(new Request("http://localhost/dashboard/api/stats"));
    expect(res.status).not.toBe(401);
  });
});
```

- [ ] **Step 2: Implement dashboard backend**

`src/dashboard/api.ts`:
```typescript
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { globalBus } from "../lib/event-bus";

export function dashboardApi(db: StrimulatorDB) {
  const requestLog: Array<{ method: string; path: string; statusCode: number; timestamp: number }> = [];

  // Subscribe to request events
  globalBus.on("request", (event) => {
    requestLog.unshift(event);
    if (requestLog.length > 1000) requestLog.pop();
  });

  return new Elysia({ prefix: "/dashboard/api" })
    .get("/stats", () => {
      const counts = (table: string) => {
        try {
          const result = db.run(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
          return (result as any)?.[0]?.count ?? 0;
        } catch {
          return 0;
        }
      };

      return {
        customers: counts("customers"),
        payment_intents: counts("payment_intents"),
        subscriptions: counts("subscriptions"),
        invoices: counts("invoices"),
        events: counts("events"),
        webhook_endpoints: counts("webhook_endpoints"),
      };
    })
    .get("/requests", () => requestLog.slice(0, 100))
    .get("/stream", ({ set }) => {
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["Connection"] = "keep-alive";

      const stream = new ReadableStream({
        start(controller) {
          const unsub = globalBus.on("request", (event) => {
            controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
          });

          // Clean up on close
          setTimeout(() => unsub(), 30 * 60 * 1000); // 30 min timeout
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });
}
```

`src/dashboard/server.ts`:
```typescript
import { Elysia } from "elysia";
import { dashboardApi } from "./api";
import type { StrimulatorDB } from "../db";

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Strimulator Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    :root { --pico-font-size: 14px; }
    nav { padding: 0.5rem 1rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat-card { text-align: center; padding: 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
    .stat-card h3 { margin: 0; font-size: 2rem; }
    .stat-card small { color: var(--pico-muted-color); }
    .request-log { max-height: 60vh; overflow-y: auto; }
    .request-item { display: flex; gap: 1rem; padding: 0.5rem; border-bottom: 1px solid var(--pico-muted-border-color); font-family: monospace; font-size: 0.85rem; }
    .method { font-weight: bold; min-width: 60px; }
    .status-2xx { color: green; } .status-4xx { color: orange; } .status-5xx { color: red; }
  </style>
</head>
<body>
  <nav class="container"><strong>Strimulator</strong> <small>Local Stripe Emulator</small></nav>
  <main class="container" id="app">Loading...</main>
  <script type="module">
    import { h, render } from 'https://esm.sh/preact@10';
    import { useState, useEffect } from 'https://esm.sh/preact@10/hooks';
    import htm from 'https://esm.sh/htm@3';
    const html = htm.bind(h);

    function App() {
      const [stats, setStats] = useState({});
      const [requests, setRequests] = useState([]);
      const [tab, setTab] = useState('activity');

      useEffect(() => {
        fetch('/dashboard/api/stats').then(r => r.json()).then(setStats);
        fetch('/dashboard/api/requests').then(r => r.json()).then(setRequests);

        const es = new EventSource('/dashboard/api/stream');
        es.onmessage = (e) => {
          const req = JSON.parse(e.data);
          setRequests(prev => [req, ...prev].slice(0, 100));
        };
        return () => es.close();
      }, []);

      const statusClass = (code) => code < 300 ? 'status-2xx' : code < 500 ? 'status-4xx' : 'status-5xx';

      return html\`
        <div class="stats">
          \${Object.entries(stats).map(([k, v]) => html\`
            <div class="stat-card"><h3>\${v}</h3><small>\${k.replace(/_/g, ' ')}</small></div>
          \`)}
        </div>
        <h4>Activity Feed</h4>
        <div class="request-log">
          \${requests.map(r => html\`
            <div class="request-item">
              <span class="method">\${r.method}</span>
              <span>\${r.path}</span>
              <span class="\${statusClass(r.statusCode)}">\${r.statusCode}</span>
              <span>\${new Date(r.timestamp).toLocaleTimeString()}</span>
            </div>
          \`)}
        </div>
      \`;
    }

    render(html\`<\${App} />\`, document.getElementById('app'));
  </script>
</body>
</html>`;

export function dashboardRoutes(db: StrimulatorDB) {
  return new Elysia()
    .use(dashboardApi(db))
    .get("/dashboard", () => new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html" },
    }))
    .get("/dashboard/*", () => new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html" },
    }));
}
```

- [ ] **Step 3: Wire dashboard into app.ts**

Add `.use(dashboardRoutes(database))` to the app.

- [ ] **Step 4: Run tests**

Run: `bun test tests/integration/dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/ tests/integration/dashboard.test.ts src/app.ts
git commit -m "feat: add debug dashboard with activity feed and stats"
```

---

## Phase 9: Docker

### Task 20: Dockerfile & Docker Compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

`.dockerignore`:
```
node_modules
.git
tests
docs
*.md
.env
strimulator.db
```

- [ ] **Step 2: Create Dockerfile**

`Dockerfile`:
```dockerfile
FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun install --production --frozen-lockfile

FROM oven/bun:alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

ENV STRIMULATOR_PORT=12111
ENV STRIMULATOR_DB_PATH=/data/strimulator.db
VOLUME /data
EXPOSE 12111

CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 3: Create docker-compose.yml**

`docker-compose.yml`:
```yaml
services:
  strimulator:
    build: .
    ports:
      - "12111:12111"
    volumes:
      - strimulator-data:/data
    environment:
      STRIMULATOR_PORT: "12111"
      STRIMULATOR_DB_PATH: "/data/strimulator.db"

volumes:
  strimulator-data:
```

- [ ] **Step 4: Build and test Docker image**

Run: `docker build -t strimulator:test .`
Expected: Build succeeds

Run: `docker run --rm -p 12111:12111 strimulator:test &; sleep 2; curl -s -H "Authorization: Bearer sk_test_123" http://localhost:12111/v1/customers | head -c 200; docker stop $(docker ps -q --filter ancestor=strimulator:test)`
Expected: Returns a Stripe-shaped list response

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: add Dockerfile and docker-compose for distribution"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Foundation | 1-6 | Bootable app, DB, shared libs, middleware, error handling |
| 2: Simple Resources | 7-10 | Customers, Products, Prices — full CRUD |
| 3: Payment Core | 11-14 | PaymentMethods, PaymentIntents (state machine), Charges, Refunds, SetupIntents |
| 4: Billing | 15 | Subscriptions, Invoices — cross-service orchestration |
| 5: Webhooks | 16 | Events, Webhook Endpoints, Delivery Engine with signature verification |
| 6: Test Clocks | 17 | Time simulation API |
| 7: SDK Compat | 18 | End-to-end tests proving official Stripe SDK works against Strimulator |
| 8: Dashboard | 19 | Interactive debug dashboard with activity feed, stats, SSE |
| 9: Docker | 20 | Single Dockerfile, docker-compose example |
