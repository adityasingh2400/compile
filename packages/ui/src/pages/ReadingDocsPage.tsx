import { useStore } from "../store.js";

const DOC_POSITIONS: { left: string; top: string; rotate: string }[] = [
  { left: "8%", top: "12%", rotate: "-6deg" },
  { left: "30%", top: "8%", rotate: "1deg" },
  { left: "52%", top: "12%", rotate: "5deg" },
  { left: "72%", top: "10%", rotate: "-3deg" },
];

const DOC_TITLES = [
  "Folk · ICP.md",
  "Folk · Pricing.md",
  "Folk · UserPersona.md",
  "Folk · MessagingArchitecture.md",
];

const DOC_TEXT = [
  "Ideal Folk customer:\n• Founders, executives, creators\n• 200+ inbound DMs/day\n• Already pay for ChatGPT Plus / Claude Pro\n• North America, UK, EU\n• Comfortable with always-on agents\n• Pro tier ($100/mo) candidate\n• Travel frequency drives cron-watcher value\n• Existing AI tool spend ≥ $40/mo",
  "Pricing tiers:\nPersonal $20/mo · 6,000 msgs\nPro $100/mo · 30,000 msgs\nPlus call · custom\n\nAdd-ons:\n• WhatsApp Business API · $30/mo\n• Custom voice fine-tune · $250\n• Family plan up to 5 seats · +$60/mo",
  "User persona — Arlan:\n• 47 DMs in last 6 hours\n• Half logistics, quarter relationship\n• Lowercase, terse, busy\n• Skips greetings, jumps to asks\n• Uses emoji sparingly\n• Replies fastest to co-founder + investors\n• Replies slowest to recruiters",
  "Messaging architecture:\n• iMessage via macOS Messages full-disk-access\n• Telegram via Bot API\n• Discord via gateway WebSocket\n• Vercel AI Gateway routes Sonnet 4.5 / GPT-5\n• Nia Vault for memory + persona storage\n• Hermes Agent loop · 5–15 turns/inbound\n• 60s cron for flights, listings, calendar",
];

export function ReadingDocsPage(): JSX.Element {
  const tokens = useStore((s) => s.docTokens);
  const seedCount = useStore((s) => s.seedCount);

  return (
    <div className="docs-stage">
      {DOC_POSITIONS.map((p, i) => (
        <div
          key={i}
          className="doc-card"
          style={{
            left: p.left,
            top: p.top,
            transform: `rotate(${p.rotate})`,
          }}
        >
          <div className="doc-title">{DOC_TITLES[i]}</div>
          {DOC_TEXT[i]}
        </div>
      ))}
      <div className="seed-pool">
        <div className="seed-pool-label">
          synthetic seed inputs · grounded in customer corpus
        </div>
        <div className="seed-pool-tokens">
          {tokens.map((t, idx) => (
            <span
              key={t.id}
              className="seed-token-chip"
              style={{
                animationDelay: `${idx * 30}ms`,
              }}
            >
              {t.text}
            </span>
          ))}
        </div>
        <div className="seed-pool-counter">
          <b>{seedCount}</b> / 100 seeds · variation knobs ready ↓
        </div>
      </div>
    </div>
  );
}
