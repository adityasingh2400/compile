/**
 * Compile — landing / install page.
 *
 * The very first thing a judge (or any visitor) sees. One job:
 * communicate what Compile is in a single line, and hand them the
 * one-line MCP install command they can paste into Claude.
 *
 * Aesthetic: cream + maroon (project palette), Claude-style serif
 * display headline, generous whitespace, a single hero install
 * command with a copy button, and a quiet "see it in action"
 * primary CTA that advances `ui_stage` to "audit".
 *
 * Keyboard: Enter or Space → advance to audit.
 */

import { useEffect, useState } from "react";
import { useRedesignStore } from "../data/redesign-store.js";

const INSTALL_CMD = "claude mcp add compile -- npx @compile/mcp";

export function LandingPage(): JSX.Element {
  const setUiStage = useRedesignStore((s) => s.setUiStage);
  const [copied, setCopied] = useState(false);

  const advance = (): void => setUiStage("audit");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked (rare in modern browsers) — fall through silently.
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        advance();
      }
      if ((e.key === "c" || e.key === "C") && (e.metaKey || e.ctrlKey)) {
        // Let the browser handle real copy; only intercept naked `c`.
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="rd-landing">
      <div className="rd-landing-grain" aria-hidden />
      <div className="rd-landing-glow" aria-hidden />

      <header className="rd-landing-top">
        <div className="rd-landing-mark">
          <span className="rd-landing-mark-dot" aria-hidden />
          <span className="rd-landing-mark-name">Compile</span>
        </div>
        <nav className="rd-landing-nav">
          <a href="https://github.com/rmotgi1227/Compile" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span className="rd-landing-nav-sep">·</span>
          <span className="rd-landing-nav-tag">Nozomio · May 9, 2026</span>
        </nav>
      </header>

      <main className="rd-landing-main">
        <div className="rd-landing-eyebrow">
          <span className="rd-landing-eyebrow-dot" aria-hidden />
          MCP server · live in your agent loop
        </div>

        <h1 className="rd-landing-title">
          Compile your agent's
          <br />
          repeat work
          <span className="rd-landing-title-em"> into code.</span>
        </h1>

        <p className="rd-landing-sub">
          Codifiability decided from your repo in milliseconds, then confirmed by
          <strong> 100,000 synthetic calls in 28 seconds.</strong> One line to install.
        </p>

        <div className="rd-landing-install">
          <div className="rd-landing-install-label">
            <span className="rd-landing-install-prompt">$</span>
            <span>install in Claude</span>
          </div>
          <button
            type="button"
            className={`rd-landing-install-cmd ${copied ? "is-copied" : ""}`}
            onClick={copy}
            aria-label="Copy install command"
          >
            <code>{INSTALL_CMD}</code>
            <span className="rd-landing-install-copy">
              {copied ? (
                <>
                  <CheckIcon /> copied
                </>
              ) : (
                <>
                  <CopyIcon /> copy
                </>
              )}
            </span>
          </button>
        </div>

        <div className="rd-landing-cta-row">
          <button type="button" className="rd-landing-cta primary" onClick={advance}>
            See it in action
            <span className="rd-landing-cta-arrow" aria-hidden>→</span>
          </button>
          <button
            type="button"
            className="rd-landing-cta ghost"
            onClick={() => {
              const el = document.getElementById("rd-landing-how");
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            How it works
          </button>
          <span className="rd-landing-cta-hint">
            press <kbd>Enter</kbd> to start
          </span>
        </div>

        <ul className="rd-landing-stack" id="rd-landing-how">
          <li>
            <span className="rd-landing-stack-num">01</span>
            <div>
              <h3>Tensorlake</h3>
              <p>Real sandbox compute for the gate + Phi-3-mini Tier-2.</p>
            </div>
          </li>
          <li>
            <span className="rd-landing-stack-num">02</span>
            <div>
              <h3>Anthropic</h3>
              <p>Frontier oracle confirms the 1% Stage-2 sample.</p>
            </div>
          </li>
          <li>
            <span className="rd-landing-stack-num">03</span>
            <div>
              <h3>Nia</h3>
              <p>Vault writes + Document Agent grounding for every codified path.</p>
            </div>
          </li>
        </ul>
      </main>

      <footer className="rd-landing-foot">
        <span>90 seconds end to end · MCP-native</span>
        <span className="rd-landing-foot-sep">·</span>
        <span>Built at the EF office, San Francisco</span>
      </footer>
    </div>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 12 5 5L20 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
