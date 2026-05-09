# Compile — Convex backend

Reactive state engine for the eleven-page bootstrap demo (DESIGN.md, ENG_REVIEW.md D7).
The UI subscribes to these tables; Lane B writes via `@compile/stream`'s
`ConvexBootstrapStream`, which wraps a thin `IConvexClientLike` seam so
the Convex SDK is a swap-in (mirrors `ITensorlakeClient` / `INiaClient`).

## Tables (canonical)

| Table | Cardinality | Drives |
|---|---|---|
| `bootstrap_phase` | one per `run_id` | All 11 pages auto-advance from this. |
| `scan_report` | one per `run_id` | Pages 2 + 3 (file tree, classify pills). |
| `synthetic_cells` | many per `(run_id, call_site_id)` — one per call | Page 6 constellation. Per DESIGN.md "one row per completed call to Convex". |
| `live_metrics` | one per `(run_id, call_site_id)` | Page 6 chrome (top-of-screen counters). |
| `cluster_snapshot` | many per `(run_id, call_site_id)` — versioned by `snapshot_seq` | Page 6 → 7 cluster reveal. |
| `synthetic_run` | one per `(run_id, call_site_id)` | Page 7 freeze. |
| `synthesis_event` | many per `request_id` | Pages 8 + 9 lifecycle. |
| `vault_event` | many per run | Page 10 stack-of-cards animation. |
| `result_summary` | one per `run_id` | Page 11. |

## Mutation paths

`@compile/stream` calls these by string name:

- `phase:advance`
- `scan:put`
- `cells:insertMany`
- `metrics:put`
- `clusters:put`
- `runs:complete`
- `synthesis:event`
- `vault:event`
- `result:put`

## Wire batching

DESIGN.md says "each Tensorlake worker writes one row per completed call to
Convex". The interface (`IBootstrapStream.emitCell`) preserves this — every
cell is logically one row. The `ConvexBootstrapStream` buffers calls in a
~50ms window before issuing a `cells:insertMany` mutation that inserts each
cell as its own row. Result: data model unchanged, wire transport is one
mutation per ~1K cells (~30 mutations across a 100K run).

## Deployment

**Local dev:**
```
npm run convex:dev
```
First run prompts for browser auth + project picker, writes
`CONVEX_DEPLOYMENT` and `CONVEX_URL` to `.env.local`, generates
`convex/_generated/`, and pushes schema + mutations. Subsequent runs
are watch-mode hot-push.

Active deployments:
- **Dev**: `dev:watchful-oriole-309` (`https://watchful-oriole-309.convex.cloud`)
- **Prod**: `prod:flexible-turtle-311` (`https://flexible-turtle-311.convex.cloud`)

**Production (Vercel build):**
1. In Vercel project settings, set:
   - `CONVEX_DEPLOY_KEY` — the prod deploy key from the Convex dashboard (build-time only, secret)
   - `CONVEX_URL` — `https://flexible-turtle-311.convex.cloud` (runtime, public)
2. Set the Vercel build command to:
   ```
   npx convex deploy --cmd 'npm run build'
   ```
   Convex pushes the schema/functions before the UI build runs, so a
   schema mismatch fails the deploy.

**Manual prod push** (skipping Vercel):
```
CONVEX_DEPLOY_KEY=prod:... npx convex deploy
```

**Writer-side wire:**
Lane B (and any server-side writer) builds the stream with
`createConvexAdapter({ url })` from `@compile/stream`, or
`convexAdapterFromEnv()` if `CONVEX_URL` is exported. This is the
real `IConvexClientLike` implementation; `MemoryBootstrapStream` stays
available for tests.

## Lane C handoff

Lane C imports types from `@compile/schemas` (`BootstrapPhaseDoc`,
`SyntheticCell`, `LiveMetrics`, `ClusterSnapshotDoc`, `ResultSummary`,
etc.) — those are the wire shapes. Convex `Doc<"bootstrap_phase">` should
match `BootstrapPhaseDoc` 1:1.
