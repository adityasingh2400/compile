# @compile/ui

The eleven-page bootstrap demo. Vite + React + canvas constellation.

## Run

```bash
npm run dev:ui            # http://localhost:5173 — auto-runs the 90s timeline
```

## Modes

| URL | Source | When to use |
|---|---|---|
| `/` | Baked fixtures | Most demos. Deterministic, robust. |
| `/?source=real` | `public/bootstrap-snapshot.json` (real scanner output) | Stretch beat — judges see "this is your repo, not a recording". A `LIVE` badge appears in the page corner. |

## Regenerate the live snapshot

The snapshot file is produced by running the real scanner + synth-loader pipeline against the Acme demo repo. Run before every demo:

```bash
npm run snapshot          # writes packages/ui/public/bootstrap-snapshot.json
```

## Operator hotkeys

| Key | Action |
|---|---|
| `space` / `→` | Advance to next phase |
| `←` | Back one phase |
| `1`–`9` | Jump to page 1-9 |
| `R` | Reset and replay from page 1 |
| `O` | Toggle the dev panel (page jump buttons + replay) |

Hotkeys halt the auto-timeline (`manualOverride`). Pressing `R` clears it and re-runs the whole sequence. ENG_REVIEW failure mode #4 is covered.

## Architecture (one-paragraph)

`store.ts` is the single source of truth — a Zustand store mirroring the
`IBootstrapStream` event shapes from `@compile/schemas`. The auto-timeline
(`demo/timeline.ts`) and per-phase mount drivers (`demo/page-drivers.ts`) write
into it. Every page subscribes via `useStore` and re-renders.

The constellation lives in `components/PersistentConstellation.tsx` — a fixed
`<canvas>` mounted globally that fades in on the stress-test phase, persists
through clusters-revealed and dimmed under the agent-writes editor. This is
what makes pages 6 → 7 → 8 feel like one continuous animation instead of three
disconnected screens.

## Pages

| # | Phase | Component |
|---|---|---|
| 1 | `connect` | `ConnectPage` — terminal types the install command |
| 2 | `reading_code` | `ReadingCodePage` — file tree + scrolling source |
| 3 | `classify` | `ClassifyPage` — green/yellow/red pills (codifiability decided) |
| 4 | `reading_docs` | `ReadingDocsPage` — Acme docs fan out, seed tokens float |
| 5 | `expanding` | `ExpandingPage` — 100 → 100,000 dot field |
| 6 | `stress_test` | `StressTestPage` (canvas behind) — constellation hero |
| 7 | `clusters_revealed` | `ClustersRevealedPage` — labels fly in over frozen constellation |
| 8 | `agent_writing` | `AgentWritesPage` — spec envelope flies into editor, code typewriter |
| 9 | `validate` | `ValidatePage` — 100-cell holdout grid + score |
| 10 | `vault_write` | `VaultWritePage` — new card slots into Vault stack |
| 11 | `result` | `ResultPage` — animated $-savings + negative vault breakdown |
