# Support Thread Summarization Playbook

> Customer Success · last updated by Aanya Krishnamurthy

`acme/agent/summarize_support_thread.ts` produces summaries that paste
into the closing note of a Zendesk ticket. The summary is read by:

1. The on-call engineer who picks up the ticket the next time the customer
   writes in
2. Quarterly QBR prep — CSMs grep these summaries for trend patterns
3. The product team during sprint review when triaging bug clusters

## What a good summary contains

- The original ask, in one sentence
- The diagnosis, if reached
- The resolution, or the current blocker
- Any commitments we made (refund, follow-up call, ETA on a fix)

## What to leave out

- Pleasantries, signatures, "+ team" CCs
- Repeated quotes from earlier messages
- The customer's internal slack handle if it leaked into the thread

## Tone

Neutral, present tense, no hedging. "Customer reports …" not "Customer
seems to be saying …". We use these in legal review occasionally — keep
them factual.
