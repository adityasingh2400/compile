import type { CallSiteDescriptor } from "@compile/schemas";
import { useStore } from "../store.js";

function Pill({ site, pulse }: { site: CallSiteDescriptor; pulse: boolean }): JSX.Element {
  const p = site.priors;
  return (
    <div className={`pill ${p.pill} ${pulse ? "pulse" : ""}`}>
      <span className="dot" />
      <span className="name">{site.function_hint ?? site.call_site_id}</span>
      <span className="bars">
        <span className="bar">
          <span style={{ transform: `scaleX(${p.schema_stability_prior})` }} />
        </span>
        <span className="bar">
          <span style={{ transform: `scaleX(${p.determinism_prior})` }} />
        </span>
        <span className="bar">
          <span style={{ transform: `scaleX(${p.economic_value_prior})` }} />
        </span>
      </span>
    </div>
  );
}

export function ClassifyPage(): JSX.Element {
  const sites = useStore((s) => s.callSites);
  const greens = sites.filter((s) => s.priors.pill === "green");
  const yellows = sites.filter((s) => s.priors.pill === "yellow");
  const reds = sites.filter((s) => s.priors.pill === "red");

  return (
    <>
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--mono)",
          fontSize: 14,
          color: "var(--muted)",
          letterSpacing: "0.08em",
          marginBottom: 28,
        }}
      >
        codifiability decided from code · <b style={{ color: "var(--cyan)" }}>no LLM calls yet</b>
      </div>
      <div className="classify-buckets">
        <div className="bucket-col green">
          <h3>
            <b>GREEN</b> · advance to Stage 2 · {greens.length}
          </h3>
          {greens.map((s) => (
            <Pill key={s.call_site_id} site={s} pulse={true} />
          ))}
        </div>
        <div className="bucket-col yellow">
          <h3>
            <b>YELLOW</b> · advance with stricter thresholds · {yellows.length}
          </h3>
          {yellows.map((s) => (
            <Pill key={s.call_site_id} site={s} pulse={false} />
          ))}
        </div>
        <div className="bucket-col red">
          <h3>
            <b>RED</b> · negative vault · {reds.length}
          </h3>
          {reds.map((s) => (
            <Pill key={s.call_site_id} site={s} pulse={false} />
          ))}
        </div>
      </div>
    </>
  );
}
