import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store.js";

const KW = new Set([
  "import",
  "from",
  "const",
  "export",
  "async",
  "function",
  "return",
  "if",
  "true",
  "false",
  "await",
]);

function tokenize(src: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  const re =
    /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][A-Za-z0-9_$]*\b)|([\s\S])/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(<span className="com" key={i++}>{m[1]}</span>);
    else if (m[2]) out.push(<span className="com" key={i++}>{m[2]}</span>);
    else if (m[3]) out.push(<span className="str" key={i++}>{m[3]}</span>);
    else if (m[4]) out.push(<span className="num" key={i++}>{m[4]}</span>);
    else if (m[5]) {
      const w = m[5];
      if (KW.has(w)) out.push(<span className="key" key={i++}>{w}</span>);
      else if (w === "z" || w === "llmFallback" || w === "Compile")
        out.push(<span className="imp" key={i++}>{w}</span>);
      else out.push(<span key={i++}>{w}</span>);
    } else out.push(<span key={i++}>{m[6]}</span>);
  }
  return out;
}

const SPEC_PREVIEW = `{
  "request_id": "syn_a3f2",
  "cluster_id": "c0..c6",
  "prompt_template": "Classify support ticket priority…",
  "tool_schemas": [TicketPrioritySchema],
  "traces": { "train": 70_000, "val": 15_000, "holdout": 15_000 },
  "axis_scores": {
    "schema_stability": 0.984,
    "determinism": 0.991,
    "oracle_agreement": 0.946
  },
  "customer_docs": ["icp.md", "pricing.md", "policy.md"]
}`;

export function AgentWritesPage(): JSX.Element {
  const full = useStore((s) => s.agentCodeFull);
  const revealed = useStore((s) => s.agentCodeRevealed);
  const visible = useMemo(() => full.slice(0, revealed), [full, revealed]);
  const isComplete = revealed >= full.length && full.length > 0;
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [envelopeFlying, setEnvelopeFlying] = useState(false);

  useEffect(() => {
    setShowEnvelope(true);
    setEnvelopeFlying(false);
    const t1 = setTimeout(() => setEnvelopeFlying(true), 1300);
    const t2 = setTimeout(() => setShowEnvelope(false), 2400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [full]);

  return (
    <div className="overlay-root agent-stage">
      {showEnvelope ? (
        <div className={`spec-envelope ${envelopeFlying ? "flying" : ""}`}>
          <div className="spec-envelope-tag">synthesis spec</div>
          <pre>{SPEC_PREVIEW}</pre>
        </div>
      ) : null}
      <div className="agent-writes">
        <header>
          <span className="lights">
            <span style={{ background: "#ff6b8b" }} />
            <span style={{ background: "#ffd166" }} />
            <span style={{ background: "#5afca7" }} />
          </span>
          compile · synthesis spec → claude-code
          <span className="name">fn_classify_ticket_priority.ts</span>
        </header>
        <pre>
          {tokenize(visible)}
          {isComplete ? null : <span className="caret" />}
        </pre>
      </div>
      <div className="agent-callout">
        the agent writes the function that <b>retires its own future calls</b>
        <br />
        <span className="agent-callout-sub">
          customer's keys · customer's data · compile spends zero frontier tokens
        </span>
      </div>
    </div>
  );
}
