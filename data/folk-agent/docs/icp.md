# Folk — Ideal Customer Profile

Folk is a personal AI agent that lives in iMessage, Telegram, and Discord.
It drafts your replies in your own voice, watches your flights, and surfaces
the threads that actually need you.

## Tier A (highest fit)

- Founders, executives, investors, creators
- 200+ inbound DMs per day across iMessage + Telegram + Discord
- Already pay for premium AI (ChatGPT Plus, Claude Pro, Cursor Pro)
- Comfortable with always-on agents reading their messages
- North America, UK, EU
- Pro tier ($100/mo) candidates

## Tier B (mid fit)

- High-context professionals (consultants, lawyers, sales leaders)
- 50–200 inbound DMs per day, mostly logistics + relationships
- Already use a calendar + task agent (Reclaim, Motion, Superhuman)
- Personal tier ($20/mo) candidates

## Tier C (low fit)

- Casual users, < 50 DMs/day
- Privacy-cautious — uncomfortable with agents reading personal messages
- Heavy WhatsApp / Signal users (no first-party support yet)

## Hard disqualifiers

- Refuse to grant Messages full-disk-access permission on macOS
- iMessage-blocked geographies (mainland China, parts of MENA)
- Regulated industries that prohibit third-party message processing
  (finance compliance teams, legal discovery contexts, healthcare)

## Signals we track

- Inbound message velocity (last 7 days)
- Reply latency (median time-to-respond)
- Active hours / "always-on-phone" patterns
- Existing AI tool spend (proxy for willingness to pay $100/mo)
- Relationship graph density (close friends, partners, business contacts)
- Travel frequency (drives the cron-watcher value prop)

## Persona — Arlan, the indexer

The canonical Folk user is the founder who got 47 DMs in the last 6 hours,
half of them logistics, a quarter relationship maintenance, and just a
handful that need a real human reply. Folk decides which is which, drafts
the rest in his voice, and only surfaces the texts where the human is
genuinely the bottleneck.

> *"Folk is not a chatbot. It's the assistant that stops you from being one."*
