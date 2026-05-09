import { useStore } from "../store.js";

const DOC_POSITIONS: { left: string; top: string; rotate: string }[] = [
  { left: "8%", top: "28%", rotate: "-6deg" },
  { left: "30%", top: "20%", rotate: "1deg" },
  { left: "52%", top: "30%", rotate: "5deg" },
  { left: "70%", top: "22%", rotate: "-3deg" },
];

const DOC_TITLES = [
  "Acme · ICP.md",
  "Acme · Pricing.md",
  "Acme · Policy.md",
  "Acme · CompetitiveLandscape.md",
];

const DOC_TEXT = [
  "Ideal customer profile:\n• Mid-market SaaS\n• 50-1000 employees\n• Payment infra or vertical AI\n• North America or EMEA\n• ARR $1M – $50M\n• Series A through C\n• PLG or hybrid\n• Pain: integration cost\n• Decision criteria: TTV ≤ 14 days",
  "Pricing tiers:\nStarter $99/mo · 100K events\nPro $499/mo · 2M events\nEnterprise call · custom\n\nUsage-based add-ons:\n• Compute hours\n• Storage GB\n• Outbound bandwidth",
  "Trust & compliance:\nSOC2 Type II\nGDPR · CCPA\nHIPAA available on Enterprise tier\nSSO via SAML / OIDC\nSCIM provisioning\nTraffic encrypted in transit and at rest",
  "Competitors:\n• Stripe — payments only\n• Plaid — banking data\n• Persona — identity\n\nDifferentiators:\n• End-to-end risk model\n• Embedded UX components\n• Network effects via shared signals",
];

export function ReadingDocsPage(): JSX.Element {
  const tokens = useStore((s) => s.docTokens);
  const seedCount = useStore((s) => s.seedCount);

  return (
    <div className="docs-stage">
      <div className="seed-pool-counter">
        seed inputs generated · <b>{seedCount}</b> / 100
      </div>
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
      {tokens.map((t) => (
        <div
          key={t.id}
          className="seed-token"
          style={{
            left: `${t.x}%`,
            top: `${t.y}%`,
            transform: `translate(-50%, -50%)`,
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
