# Fumadocs Documentation — Design Spec

## Overview

Add a beautiful, auto-generated documentation site to Strimulator using Fumadocs (Next.js). The docs live in `docs/` as a monorepo setup. API reference pages are auto-generated from an OpenAPI spec extracted from the codebase.

## Content Areas

### 1. Getting Started
- **Installation** — bun/npm/docker install, environment variables
- **Quick Start** — spin up Strimulator, make first API call
- **Connecting the Stripe SDK** — configure official `stripe` npm package to point at Strimulator

### 2. API Reference (auto-generated)
All 13 resources with endpoints, parameters, response shapes, and code examples:
- Customers, Products, Prices
- Payment Intents, Payment Methods, Charges, Refunds
- Setup Intents, Subscriptions, Invoices
- Events, Webhook Endpoints, Test Clocks

Generated from an OpenAPI spec via `fumadocs-openapi`.

### 3. Guides
- **Webhooks** — registering endpoints, HMAC verification, retry behavior
- **Test Clocks** — creating clocks, advancing time, billing cycle simulation
- **3DS Simulation** — triggering `requires_action`, completing 3DS challenges
- **Dashboard** — activity feed, resource explorer, actions panel
- **Idempotency** — how idempotency keys work in Strimulator

### 4. Architecture / Contributing
- **Overview** — tech stack, project structure
- **Request Lifecycle** — middleware chain, body parsing, expansion, events
- **Services** — service pattern, state machines, DB conventions
- **Contributing** — dev setup, running tests, adding new resources

## Directory Structure

```
docs/
  package.json              # Next.js + Fumadocs deps
  next.config.mjs
  source.config.ts          # Fumadocs content source
  tsconfig.json
  content/docs/
    index.mdx               # Docs landing page
    meta.json                # Root navigation order
    getting-started/
      meta.json
      installation.mdx
      quick-start.mdx
      connecting-sdk.mdx
    guides/
      meta.json
      webhooks.mdx
      test-clocks.mdx
      3ds-simulation.mdx
      dashboard.mdx
      idempotency.mdx
    api/
      meta.json
      (auto-generated MDX files from OpenAPI spec)
    architecture/
      meta.json
      overview.mdx
      request-lifecycle.mdx
      services.mdx
      contributing.mdx
  app/
    layout.tsx              # Root layout with Fumadocs provider
    (docs)/
      [[...slug]]/
        page.tsx            # Docs page renderer
    api/
      (auto-generated API page components)
  openapi.json              # Generated OpenAPI spec
  scripts/
    generate-openapi.ts     # Builds openapi.json from route/service analysis
    generate-docs.ts        # Runs fumadocs-openapi to produce MDX from spec
```

## Technical Approach

### OpenAPI Spec Generation

A TypeScript script (`docs/scripts/generate-openapi.ts`) constructs an OpenAPI 3.1 spec by:
- Defining each of the 13 resources and their endpoints
- Documenting request parameters (path params, query params, form-encoded body fields)
- Documenting response schemas matching Stripe object shapes
- Including authentication requirements (Bearer `sk_test_*`)
- Documenting error response shapes

This is a hand-maintained script that mirrors the route definitions — not runtime introspection. When routes change, the script is updated and re-run.

### Fumadocs OpenAPI Integration

Uses `fumadocs-openapi` package:
1. `createOpenAPI()` loads the spec in server components
2. `generateFiles()` script produces MDX files in `content/docs/api/`
3. API pages render with interactive parameter tables, request/response examples, and code snippets

### Fumadocs UI

- Default Fumadocs UI theme (`fumadocs-ui`)
- Project branding: title "Strimulator", description, optional logo
- Built-in full-text search
- Dark mode support
- Responsive layout
- Syntax-highlighted code blocks

### Package Manager

Bun — consistent with the main project.

### Dev Workflow

```bash
cd docs
bun install
bun run dev          # Start Fumadocs dev server
bun run build        # Production build
bun run generate     # Regenerate API docs from OpenAPI spec
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Fumadocs (Next.js) | Best UI, OpenAPI integration, TypeScript-native |
| Location | `docs/` monorepo | Docs stay in sync with code |
| API docs | Auto-generated from OpenAPI spec | 13 resources with many endpoints — manual is unsustainable |
| OpenAPI generation | Hand-maintained script | More control than runtime introspection, simpler than decorators |
| Package manager | Bun | Consistent with main project |
| i18n | None | English only |
| Search | Built-in Fumadocs search | No external service needed |

## Out of Scope

- Custom domain / deployment (can be added later)
- Internationalization
- Blog section
- Versioned docs (single version for now)
- Interactive API playground with live Strimulator instance
