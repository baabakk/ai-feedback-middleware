# multi-tenant-feedback

How to run one framework instance across many customer tenants with their event streams cleanly isolated. No schema changes, no separate database per tenant — `partition_key` is the boundary.

## Problem

You're building a SaaS product on top of the framework. Tenant A's feedback events must not leak into Tenant B's reads, projections, or actionability rules. Spinning up a separate framework instance per tenant doesn't scale: you'd have to provision a database per tenant, manage migrations per tenant, etc.

## Solution

The framework exposes `partition_key` on every event. It treats the value as opaque — the framework doesn't care what it means. Consumers:

1. Prefix `partition_key` (and `artifact_id`) with the tenant_id when capturing.
2. Filter by `partition_key.startsWith(tenant_id)` (or by the `partition_key` field directly via `ReactionFilter.partition_key`) when reading.
3. Index `partition_key` in your adapter — the shipped Postgres + in-memory adapters do this.

Wrap the capture-port methods in a tenant-aware client so business code never has to remember to set `partition_key`. Forgetting is the failure mode; guard it at the seam.

## Run

```bash
pnpm --filter multi-tenant-feedback start
```

## What it shows

- `makeTenantClient(feedback, { tenant_id })` factory that prefixes `artifact_id` + `partition_key`
- Tenant-scoped reads via `partition_key.startsWith(tenant_id + "/")` filtering
- Cross-tenant aggregation (admin / observability view) by parsing the prefix back out
- Three tenants with overlapping logical artifact_ids (`draft-001`) coexisting without collision

## Two prefix conventions

| Convention | Looks like | Use when |
|---|---|---|
| `${tenant_id}/${artifact_id}` (this example) | `acme/draft-001` | You want one partition per artifact + tenant-prefix isolation. Cleanest for most consumers. |
| `${tenant_id}` (one partition per tenant) | partition_key = `acme` for ALL of tenant acme's events | You want ordered global stream per tenant (e.g. for SSE feeds). Costs you per-artifact partition granularity. |

Pick once; document it; enforce it in the tenant-client wrapper.

## Tenant-scoped actionability rules

The framework's `ActionabilityRule.applies_when` predicate supports `task_type`, `task_type_prefix`, `producer`, `artifact_type`, and `action`. To scope a rule to one tenant:

- Bake the tenant into `task_type`: e.g. `task_type: "tenant:acme:outbound:warm_intro"`, then `applies_when.task_type_prefix: "tenant:acme:"`
- OR keep the rule global and post-filter decisions by tenant after reading

The framework doesn't enforce tenant isolation on rules — that's your responsibility, same as it's your responsibility to set `partition_key`.

## Production checklist

- [ ] Swap in-memory adapters for Postgres (`createPostgresEventStore` etc.)
- [ ] Verify your Postgres indexes include `partition_key` (the shipped migrations do)
- [ ] If your tenants share a Postgres database, consider row-level-security as a defense-in-depth layer on top of `partition_key` filtering
- [ ] Add tenant-id to your `provenance.instance_id` for audit traceability
- [ ] Test isolation: write a test that captures for Tenant A and asserts a Tenant B reader sees zero rows
