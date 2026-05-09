# Lead Tier Rubric

> Internal — Acme Sales Ops · last updated by Priya Shah

The rubric below defines how we tier inbound leads. The classifier in
`acme/agent/classify_lead_tier.ts` consumes this rubric implicitly via the
prompt template; any change here changes lead routing at the SDR layer.

## Tiers

- **small** — companies under 200 employees OR under $20M in revenue.
  These get assigned to the SMB pod and run through the self-serve trial
  flow. ~62% of inbound.
- **mid** — 200–2,500 employees, $20M–$500M revenue. Assigned to the
  AE-led mid-market team. ~28% of inbound.
- **large** — 2,500+ employees, $500M+ revenue. Routed to the strategic
  accounts team. ~10% of inbound. Always pair with a named exec sponsor.

## Verticals we see most

- fintech (banks, insurers, payments) — large vertical, longer sales cycles
- healthcare (payors, providers, healthtech) — heavy procurement
- edu (K-12, higher ed) — budget-cyclical, usually small/mid
- retail / ecommerce — fast-moving, mid-tier dominant
- manufacturing — slow, large-tier dominant
- professional services — wide spread across all tiers
- public sector — never small; treat as large regardless of headcount

## Confidence

Confidence is the model's self-reported probability that the tier is
correct. We treat <0.6 as "needs human review" and route those to an SDR
inbox. Our P50 confidence on a clean signal is ~0.88.
