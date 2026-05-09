# Acme corpus — Lane D fixture

Fake Notion + Slack content the Nia Document Agent grounds against when
generating synthetic seed inputs for Stage 2.

| Doc | Grounds which call site |
|---|---|
| `notion/lead-tier-rubric.md` | `classify_lead_tier.ts` — tier definitions, vertical distribution |
| `notion/invoice-format-spec.md` | `extract_invoice_fields.py` — field defs, vendor edge cases, volume |
| `notion/support-playbook.md` | `summarize_support_thread.ts` — what to keep / drop, tone |
| `notion/domain-resolution-policy.md` | `resolve_company_domain.ts` — sources of truth, ambiguity rules |
| `slack/sales-tier-thread.md` | `classify_lead_tier.ts` — quirks, "Visa-as-company-vs-document" gotcha |
| `slack/ap-invoice-thread.md` | `extract_invoice_fields.py` — AWS layout change, EUR conversion |

The corpus is intentionally small (six docs) — production would index the
real customer Notion + Slack via Nia connectors. For the demo, the synthetic
input generator reads these flat-file copies directly. Live Nia Document
Agent calls work the same way (just via `source_id` + `query` POST).
