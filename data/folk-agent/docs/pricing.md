# Folk Pricing

| Plan | Inbound msgs/mo | Monthly | Annual | Notes |
|---|---|---|---|---|
| Personal | 6,000 | $20 | $200 | 1 messaging integration · 30-day memory |
| Pro | 30,000 | $100 | $1,000 | All integrations · 1-year memory · cron watchers |
| Plus | unlimited | Custom | Custom | Family / team plans, dedicated support |

All plans:

- iMessage, Telegram, Discord (native integrations)
- Drafts your replies in your voice — auto-send is opt-in per contact
- Cron watchers: flights, listings, prices, calendar conflicts
- Nia Vault memory (private, self-hostable on Pro+)
- Privacy: messages never leave US infrastructure

Add-ons:

- WhatsApp Business API integration: $30/mo (Pro+ only)
- Custom voice fine-tune (1,000+ msg corpus): $250 one-time
- Family plan up to 5 seats: +$60/mo

## Frontier model spend (the cost story)

Folk routes through Vercel AI Gateway with a Sonnet 4.5 / GPT-5 mix.
Per-inbound-message cost on the agentic loop averages $0.18–$0.42 today
(driven by 5–15 turn loops with 25–40K input tokens per turn). At Pro
tier's 30,000 msgs/mo, that's $5,400–$12,600 of frontier spend per Pro
seat per month — currently subsidized by the $100 sticker.

The cron-watcher path (flights, listings, calendar polls) fires every
60 seconds per active watcher, with no shared cache between ticks, so
its aggregate token spend exceeds the inbound-message path 2–3× even
though it's invisible to the user.

This is the spend Compile retires.
