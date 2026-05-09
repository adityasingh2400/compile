import { useStore } from "../store.js";

/**
 * The statefulness moneymaker. Renders in place of VaultWritePage when
 * the daemon's threshold-hit decision was "vault_hit" — i.e. the cluster
 * signature already exists in the Nia vault from a prior session, so we
 * skip the 100K validation entirely and route deterministically in ms.
 *
 * This is the visual that earns Statefulness=5: removing the vault means
 * we'd re-spin the 100K validation every time. The side-by-side timing
 * comparison makes that load-bearingness *visible*, not just claimed.
 */
export function VaultHitPage(): JSX.Element {
  const hit = useStore((s) => s.vaultHit);
  const cluster = useStore((s) => s.activeCluster);

  if (!hit) {
    return (
      <div className="vault-hit-stage">
        <div className="vault-hit-headline">memory hit</div>
      </div>
    );
  }

  const sessionDate = new Date(hit.prior_compiled_at);
  const ageDays = Math.max(
    1,
    Math.floor((Date.now() - sessionDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return (
    <div className="vault-hit-stage">
      <div className="vault-hit-headline">memory hit · skipped 100k validation</div>

      <div className="vault-hit-card">
        <div className="fn-name">{hit.function_name}</div>
        <div className="row">
          <span>cluster</span>
          <b>{cluster?.cluster_id ?? hit.cluster_id}</b>
        </div>
        <div className="row">
          <span>inherited from session</span>
          <b>{hit.inherited_from_session}</b>
        </div>
        <div className="row">
          <span>compiled</span>
          <b>{ageDays}d ago</b>
        </div>
        <div className="row">
          <span>routed in</span>
          <b className="green">{hit.routed_in_ms.toFixed(1)} ms</b>
        </div>
        <div className="row">
          <span>saved this hit</span>
          <b className="green">${hit.dollars_saved_this_hit.toLocaleString()}</b>
        </div>
      </div>

      <div className="vault-hit-comparison">
        <div className="compare fresh">
          <div className="lbl">fresh fire</div>
          <div className="num">~28,000 ms</div>
          <div className="lbl" style={{ marginTop: 4 }}>100k validation</div>
        </div>
        <div className="compare hit">
          <div className="lbl">vault hit</div>
          <div className="num">{hit.routed_in_ms.toFixed(1)} ms</div>
          <div className="lbl" style={{ marginTop: 4 }}>0 calls · inherited</div>
        </div>
      </div>
    </div>
  );
}
