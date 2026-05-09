# @compile/daemon — Always-On Worker

Local Node process that turns Compile into an autonomous, multi-source-triggered agent.
Pairs with the Convex deployment (`flippant-rooster-604`) which hosts triggers + state.

## Why split (not full Convex)

Spike confirmed Convex Node runtime cannot bundle the `tensorlake` SDK
(undici incompatibility — `Ct.util.markAsUncloneable is not a function`).
Convex hosts triggers, state, UI subscriptions, sponsor surface. The
daemon hosts the heavy compute that needs Tensorlake.

## Trigger sources (all verified by `npm run daemon:smoke`)

| # | Trigger | Where | What fires it |
|---|---|---|---|
| 1 | `TRIGGER:SCHEDULE` | Convex `crons.replayTick` (1s) | Time-based replay tick |
| 2 | `TRIGGER:EVENT` | Convex `daemon/replay.tick` | New trace inserted into proxy_traces |
| 3 | `TRIGGER:VOLUME` | Convex `daemon/ingest.ingestInline` | Bucket count crosses THRESHOLD (30) |
| 4 | `TRIGGER:CODE_CHANGE` | Local `code-watch.ts` (30s) | SHA of `data/acme-agent/` changes |
| 5 | `TRIGGER:RECOVERY` | Local `worker.ts` `onRecovery` hook | Tensorlake primary fails → fallback engages |

`BOOT` rows mark daemon startups; `STEP` rows mark pipeline transitions.

## Statefulness

Memory is load-bearing. Removing `vault_index` causes duplicate VOLUME
fires; removing `replay_state` rewinds the replay; removing
`daemon_heartbeat` breaks `heartbeat.status`. All persisted in Convex.

## Run

```bash
# one-time
npm run seed:convex                # load 250 seed traces

# daemon (long-running)
npm run dev:daemon                 # local Node worker

# control
npm run daemon:ctl status          # snapshot
npm run daemon:ctl pause | start
npm run daemon:ctl reset
npm run daemon:ctl speed 500
npm run daemon:ctl bump-sha        # trigger CODE_CHANGE
npm run daemon:ctl inject acme:classify_lead_tier:v1 5

# end-to-end smoke
npm run daemon:smoke
```

## Pipeline

`packages/daemon/src/fire-compile.ts` orchestrates:

1. `scanRepo("data/acme-agent")` — Stage 1, instant
2. `runStage2(...)` — 1000 synthetic calls via Tensorlake (with local fallback)
3. axis-score gate — schema/det/oracle ≥ 0.95/0.95/0.90
4. stub customer agent → pre-baked envelope from `fixtures.ts`
5. write to Convex `vault_index` (cache); UI subscribes

Real 100K-call hero animation stays in the synchronous MCP demo path — the
daemon's job is autonomous orchestration across many compiles, not the
single hero animation.
