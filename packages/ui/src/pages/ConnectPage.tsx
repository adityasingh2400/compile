import { useEffect, useState } from "react";

const COMMAND = "claude mcp add compile -- npx @compile/mcp";

const HANDSHAKE_LINES = [
  { delay: 120, text: "→ resolving npm @compile/mcp@0.1.0..." },
  { delay: 220, text: "→ MCP handshake · jsonrpc/2.0 · stdio" },
  { delay: 280, text: "→ tools registered · scan_repo · synthetic_confirm · request_synthesis · submit_synthesis · run_codified · find_function · estimate_savings · observe_call · list_codify_candidates" },
  { delay: 240, text: "✓ compile · acme/agent · 9 tools · ready · 142ms" },
];

export function ConnectPage(): JSX.Element {
  const [typed, setTyped] = useState("");
  const [doneTyping, setDoneTyping] = useState(false);
  const [linesShown, setLinesShown] = useState(0);

  useEffect(() => {
    setTyped("");
    setDoneTyping(false);
    setLinesShown(0);
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(COMMAND.length, i + 2);
      setTyped(COMMAND.slice(0, i));
      if (i >= COMMAND.length) {
        clearInterval(id);
        setTimeout(() => setDoneTyping(true), 400);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!doneTyping) return;
    let cancelled = false;
    let cumulative = 0;
    HANDSHAKE_LINES.forEach((l, i) => {
      cumulative += l.delay;
      setTimeout(() => {
        if (!cancelled) setLinesShown(i + 1);
      }, cumulative);
    });
    return () => {
      cancelled = true;
    };
  }, [doneTyping]);

  return (
    <div className="connect-terminal">
      <div>
        <span className="prompt">$ </span>
        <span className="typed">{typed}</span>
        {!doneTyping && <span className="caret" />}
      </div>
      {HANDSHAKE_LINES.slice(0, linesShown).map((l, i) => (
        <div
          key={i}
          className={`handshake-line ${
            l.text.startsWith("✓") ? "resolved" : "trace"
          }`}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}
