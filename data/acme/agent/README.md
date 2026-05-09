# Acme demo agent — scanner fixture

Five LLM call sites the static scanner should classify. Hand-labeled ground
truth (Friday Derisk #1 pass criterion):

| File | Expected tier | Why |
|---|---|---|
| `classify_lead_tier.ts` | GREEN | response_format + temperature 0 + parameterized prompt + structured parse |
| `extract_invoice_fields.py` | GREEN | response_format + temperature 0 + f-string + pydantic parse |
| `resolve_company_domain.ts` | GREEN | bounded tools + response_format + temperature 0 + structured parse |
| `summarize_support_thread.ts` | YELLOW | parameterized + temperature 0, but no response_format → schema prior is weak |
| `research_competitor.ts` | RED (dynamic_prompt) | prompt built via string concat from runtime data |

Run the scanner against this directory:

```sh
npm run -w @compile/scanner build
node packages/scanner/dist/cli.js data/acme/agent -o .compile-scan.json
```
