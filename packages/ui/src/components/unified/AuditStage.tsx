/**
 * AuditStage — Tensorlake sandbox visualization.
 *
 * The agent boots a sandbox and walks the customer's repo with an
 * AST scanner. As each LLM call site is identified, a tier-decision
 * badge animates out of the scanner and lands in one of three bins:
 *   • T1 (deterministic) → codifiable, becomes a workflow tab
 *   • T2 (local model + prior) → codifiable, becomes a workflow tab
 *   • T3 (frontier-only) → negative vault
 *
 * No panel grid: the whole canvas IS the sandbox. The file tree,
 * the scrolling code stream, and the three tier bins are all
 * arranged inside one visual frame.
 */
import { useEffect, useRef } from "react";
import { useUnifiedStore } from "../../unified-store.js";
import { WORKFLOWS, NON_CODIFIABLE } from "../../demo/workflows.js";

const SCAN_FILES = [
  { path: "src/icp.ts", sites: 5 },
  { path: "src/ops.ts", sites: 5 },
  { path: "src/utils/parse.ts", sites: 0 },
  { path: "src/utils/format.ts", sites: 0 },
  { path: "src/index.ts", sites: 0 },
  { path: "src/router.ts", sites: 0 },
  { path: "package.json", sites: 0 },
  { path: "tsconfig.json", sites: 0 },
  { path: "docs/icp.md", sites: 0 },
  { path: "docs/pricing.md", sites: 0 },
];

const ASSEMBLY_ORDER = [
  // workflows in order they get discovered (codifiable + non-codifiable interleaved)
  WORKFLOWS[0]!.source_name, // classify_ticket_priority
  NON_CODIFIABLE[6]!.source_name, // classify_sentiment
  WORKFLOWS[1]!.source_name, // match_product_sku
  NON_CODIFIABLE[5]!.source_name, // extract_invoice_fields
  WORKFLOWS[2]!.source_name, // classify_lead_tier
  NON_CODIFIABLE[4]!.source_name, // resolve_company_domain
  NON_CODIFIABLE[3]!.source_name, // summarize_support_thread
  NON_CODIFIABLE[0]!.source_name, // draft_outreach_subject
  NON_CODIFIABLE[1]!.source_name, // generate_marketing_copy
  NON_CODIFIABLE[2]!.source_name, // freeform_chat_handler
];

function decisionFor(source_name: string): {
  decision: "tier_1" | "tier_2" | "tier_3";
  file_path: string;
} {
  const w = WORKFLOWS.find((x) => x.source_name === source_name);
  if (w) return { decision: w.tier_decision, file_path: w.file_path };
  const n = NON_CODIFIABLE.find((x) => x.source_name === source_name);
  if (n) return { decision: n.tier, file_path: n.file_path };
  return { decision: "tier_3", file_path: "src/?.ts" };
}

export function AuditStage(): JSX.Element {
  const audit = useUnifiedStore((s) => s.audit);
  const setAuditFiles = useUnifiedStore((s) => s.setAuditFiles);
  const setAuditFile = useUnifiedStore((s) => s.setAuditFile);
  const pushDecision = useUnifiedStore((s) => s.pushAuditDecision);
  const setRunning = useUnifiedStore((s) => s.setAuditRunning);

  // Initialize file list once on mount.
  useEffect(() => {
    if (audit.files_scanned.length === 0) {
      setAuditFiles(
        SCAN_FILES.map((f) => ({ ...f, lit: false, done: false })),
      );
    }
    setRunning(true);
    return () => {
      setRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the scan animation: file by file, then decisions stream out.
  useEffect(() => {
    let cancelled = false;
    let timeouts: ReturnType<typeof setTimeout>[] = [];

    const run = async () => {
      // Phase A — light files one at a time.
      const dur = 220;
      for (let i = 0; i < SCAN_FILES.length; i++) {
        const f = SCAN_FILES[i]!;
        timeouts.push(
          setTimeout(() => {
            if (cancelled) return;
            setAuditFile(f.path, { lit: true });
          }, i * dur),
        );
        timeouts.push(
          setTimeout(() => {
            if (cancelled) return;
            setAuditFile(f.path, { lit: false, done: true });
          }, i * dur + dur - 20),
        );
      }
      // Phase B — call sites surface as decision badges.
      const phaseBStart = SCAN_FILES.length * dur + 150;
      for (let i = 0; i < ASSEMBLY_ORDER.length; i++) {
        const src = ASSEMBLY_ORDER[i]!;
        const d = decisionFor(src);
        timeouts.push(
          setTimeout(() => {
            if (cancelled) return;
            pushDecision({
              source_name: src,
              file_path: d.file_path,
              decision: d.decision,
              placed: false,
            });
          }, phaseBStart + i * 320),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
      timeouts.forEach((t) => clearTimeout(t));
      timeouts = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t1Count = audit.sites_decided.filter((d) => d.decision === "tier_1").length;
  const t2Count = audit.sites_decided.filter((d) => d.decision === "tier_2").length;
  const t3Count = audit.sites_decided.filter((d) => d.decision === "tier_3").length;
  const filesDone = audit.files_scanned.filter((f) => f.done).length;

  return (
    <div className="ud-stage audit-stage">
      <div className="audit-frame">
        {/* sandbox header bar */}
        <header className="audit-frame-head">
          <span className="lights">
            <span style={{ background: "#ff6b8b" }} />
            <span style={{ background: "#ffd166" }} />
            <span style={{ background: "#5afca7" }} />
          </span>
          <span className="title">tensorlake sandbox · folk/agent · ast walker</span>
          <span className="status">
            <span className="dot" />
            scanning
          </span>
        </header>

        <div className="audit-grid">
          {/* file tree on the left */}
          <FileTree files={audit.files_scanned} />

          {/* scrolling code stream in the middle */}
          <CodeStream />

          {/* tier bins on the right */}
          <TierBins
            t1Count={t1Count}
            t2Count={t2Count}
            t3Count={t3Count}
            filesDone={filesDone}
          />
        </div>

        {/* decision badge stream — flies from center stream to right bins */}
        <DecisionStream decisions={audit.sites_decided} />
      </div>
    </div>
  );
}

function FileTree({
  files,
}: {
  files: { path: string; lit: boolean; done: boolean; sites: number }[];
}): JSX.Element {
  return (
    <aside className="audit-files">
      <div className="head">files</div>
      <ul>
        {files.map((f) => (
          <li
            key={f.path}
            className={`${f.lit ? "lit" : ""} ${f.done ? "done" : ""}`}
          >
            <span className="path">{f.path}</span>
            {f.done && f.sites > 0 ? (
              <span className="sites">+{f.sites}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

const SAMPLE_LINES: Array<string | { hit: boolean; text: string }> = [
  "// src/ops.ts",
  "import Anthropic from \"@anthropic-ai/sdk\";",
  "const client = new Anthropic();",
  "",
  "export async function classify_ticket_priority(input) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    temperature: 0,",
  "    response_format: zodResponseFormat(TicketSchema),",
  "  });",
  "}",
  "",
  "export async function match_product_sku(name) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    temperature: 0,",
  "  });",
  "}",
  "",
  "// src/icp.ts",
  "export async function classify_lead_tier(input) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    response_format: zodResponseFormat(LeadTierSchema),",
  "  });",
  "}",
  "",
  "export async function draft_outreach_subject(brief) {",
  { hit: true, text: "  const r = await client.messages.create({" },
  "    model: \"claude-sonnet-4-6\",",
  "    temperature: 0.9,",
  "    messages: [{ role: \"user\", content: prompt(brief) }],",
  "  });",
  "}",
];

function CodeStream(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let offset = 0;
    const tick = () => {
      offset = (offset + 0.4) % 800;
      if (ref.current) ref.current.style.transform = `translateY(-${offset}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="audit-stream">
      <div ref={ref}>
        {[...SAMPLE_LINES, ...SAMPLE_LINES, ...SAMPLE_LINES].map((line, i) => {
          const text = typeof line === "string" ? line : line.text;
          const hit = typeof line === "object" && line.hit;
          return (
            <div key={i} className={hit ? "hit" : ""}>
              {text || " "}
            </div>
          );
        })}
      </div>
      <div className="audit-stream-fade-top" />
      <div className="audit-stream-fade-bot" />
    </div>
  );
}

function TierBins({
  t1Count,
  t2Count,
  t3Count,
  filesDone,
}: {
  t1Count: number;
  t2Count: number;
  t3Count: number;
  filesDone: number;
}): JSX.Element {
  return (
    <aside className="audit-bins">
      <div className="head">tier decisions</div>
      <div className="bin t1">
        <div className="bin-num">{t1Count}</div>
        <div className="bin-lbl">tier 1 · deterministic</div>
        <div className="bin-hint">→ codifiable workflows</div>
      </div>
      <div className="bin t2">
        <div className="bin-num">{t2Count}</div>
        <div className="bin-lbl">tier 2 · local model + prior</div>
        <div className="bin-hint">→ codifiable workflows</div>
      </div>
      <div className="bin t3">
        <div className="bin-num">{t3Count}</div>
        <div className="bin-lbl">tier 3 · frontier-only</div>
        <div className="bin-hint">→ negative vault</div>
      </div>
      <div className="audit-progress">
        <span className="lbl">files scanned</span>
        <div className="bar">
          <span style={{ width: `${(filesDone / SCAN_FILES.length) * 100}%` }} />
        </div>
        <span className="val">
          {filesDone}/{SCAN_FILES.length}
        </span>
      </div>
    </aside>
  );
}

/** Decision badges fly from middle of the stream into the right-side
 *  bin matching their tier. They use absolutely-positioned divs with
 *  CSS transitions; once they reach the bin we keep them anchored
 *  there so the bin shows accumulated history. */
function DecisionStream({
  decisions,
}: {
  decisions: Array<{
    source_name: string;
    file_path: string;
    decision: "tier_1" | "tier_2" | "tier_3";
    placed: boolean;
  }>;
}): JSX.Element {
  return (
    <div className="audit-decisions">
      {decisions.map((d, i) => (
        <div
          key={d.source_name}
          className={`badge ${d.decision} flow`}
          style={{
            // Tweak vertical offset so badges don't all stack on one line
            // — compute an offset based on order of arrival.
            animationDelay: `${(i % 4) * 80}ms`,
          }}
        >
          <span className="tier">
            {d.decision === "tier_1" ? "T1" : d.decision === "tier_2" ? "T2" : "T3"}
          </span>
          <span className="name">{d.source_name}</span>
        </div>
      ))}
    </div>
  );
}
