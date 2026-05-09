import { useEffect, useRef } from "react";
import { useStore } from "../store.js";

const SAMPLE_LINES = [
  "import Anthropic from \"@anthropic-ai/sdk\";",
  "import { z } from \"zod\";",
  "",
  "const client = new Anthropic();",
  "",
  "const TicketSchema = z.object({",
  "  priority: z.enum([\"P0\", \"P1\", \"P2\", \"P3\"]),",
  "  reason: z.string(),",
  "});",
  "",
  "export async function classify_ticket_priority(input: TicketInput) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    temperature: 0,",
  "    system: \"Classify support ticket priority. Return JSON.\",",
  "    messages: [{ role: \"user\", content: JSON.stringify(input) }],",
  "  });",
  "  return TicketSchema.parse(JSON.parse(r.content[0].text));",
  "}",
  "",
  "export async function match_product_sku(name: string) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    temperature: 0,",
  "    system: \"Match SKU from product description.\",",
  "    messages: [{ role: \"user\", content: name }],",
  "  });",
  "  return r.content[0].text.trim();",
  "}",
  "",
  "export async function classify_lead_tier(input: LeadInput) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    temperature: 0,",
  "    messages: [{ role: \"user\", content: prompt(input) }],",
  "  });",
  "  return LeadTierSchema.parse(JSON.parse(r.content[0].text));",
  "}",
  "",
  "// 7 more LLM call sites in src/icp.ts and src/ops.ts...",
] as const;

export function ReadingCodePage(): JSX.Element {
  const files = useStore((s) => s.scannedFiles);
  const counter = useStore((s) => s.scanCounter);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streamRef.current) return;
    let offset = 0;
    let raf = 0;
    const tick = () => {
      offset = (offset + 0.6) % 800;
      streamRef.current!.style.transform = `translateY(-${offset}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="scan-grid">
      <div className="scan-tree">
        {files.map((f) => (
          <div
            key={f.path}
            className={`file ${f.lit ? "lit" : ""} ${f.done ? "done" : ""}`}
          >
            <span>{f.path}</span>
            {f.hits > 0 && f.done ? (
              <span className="hits">+{f.hits}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="scan-stream" style={{ position: "relative" }}>
        <div ref={streamRef}>
          {[...SAMPLE_LINES, ...SAMPLE_LINES, ...SAMPLE_LINES].map((line, i) => {
            const text = typeof line === "string" ? line : line.text;
            const hit = typeof line === "object" && line.hit;
            return (
              <div key={i} className={hit ? "hit" : ""}>
                {text || " "}
              </div>
            );
          })}
        </div>
        <div className="scan-counter">
          LLM call sites found <b>{counter}</b>
        </div>
      </div>
    </div>
  );
}
