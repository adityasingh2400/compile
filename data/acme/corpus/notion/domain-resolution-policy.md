# Company Domain Resolution

> Data Engineering · last updated by Marcus Eze

`acme/agent/resolve_company_domain.ts` resolves a free-text company name
to its canonical primary domain. This is the join key for our CRM, our
billing system, and our security review pipeline — wrong domain ⇒ data
corruption.

## Sources of truth, in priority order

1. Crunchbase canonical domain
2. Internal CRM mapping for accounts we already serve
3. DNS lookup against candidate domains (apex resolves + has MX records)

## Edge cases

- **DBAs vs legal entities** — "Meta" the brand resolves to `meta.com`,
  not `metaplatforms.com`. Always prefer the brand domain.
- **Acquisitions** — once an acquisition closes, route to the acquirer's
  primary domain. We refresh this once a quarter from Crunchbase deltas.
- **Parent / subsidiary** — for subsidiaries with independent operations
  (e.g. Instagram under Meta), we keep the subsidiary's own domain.

## Confidence

A confidence score below 0.7 means "ambiguous"; the call goes to the data
ops queue for human review. Most signals (Crunchbase + DNS agreeing) push
confidence to ~0.95.
