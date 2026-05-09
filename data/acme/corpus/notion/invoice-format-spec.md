# Invoice Extraction Spec

> AP Automation · last updated by Diego Ortiz

`acme/agent/extract_invoice_fields.py` extracts three fields from raw
invoice text (PDF OCR or pasted email body). This page is the authoritative
spec for what those fields mean.

## Field definitions

- **invoice_number** — vendor's identifier for the invoice. Format varies
  by vendor; treat as a string. Common shapes: `INV-2024-00123`,
  `2024Q1-08-MARCH-AC`, `#A887271`.
- **total_usd** — total amount due, normalized to USD. If the invoice is
  denominated in another currency, convert at the date of issue using
  Acme's daily FX snapshot. We do not net out credits or partial payments.
- **due_date** — the "Due By" or "Net N" date in ISO-8601 (YYYY-MM-DD).
  If only "Net 30" is stated, compute from invoice date.

## Common vendors and edge cases

- AWS — multiple line items, take the grand total at the bottom
- Snowflake — quarterly billing, due_date is end-of-quarter
- Notion — annual prepay, treat as one invoice for the full year
- A small set of EU vendors (Sentry, Linear) bill in EUR — convert
- Some print invoices have no invoice number at all; in that case the
  vendor + date pair is the de-facto identifier and we synthesize one as
  `<vendor-slug>-<YYYYMMDD>`

## Volume

We process about 1,400 invoices per month across roughly 280 vendors.
