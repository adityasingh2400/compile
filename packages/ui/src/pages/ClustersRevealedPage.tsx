import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { HERO_CALL_SITE_ID, HERO_CLUSTERS } from "../demo/fixtures.js";

function useHeroName(): string {
  return useStore((s) => {
    const id = s.fixtures?.heroCallSiteId ?? HERO_CALL_SITE_ID;
    const sites =
      s.callSites.length > 0 ? s.callSites : s.fixtures?.callSites ?? [];
    const site = sites.find((c) => c.call_site_id === id);
    return site?.function_hint ?? id.split(":")[1] ?? id;
  });
}

/**
 * Page 7. The constellation is rendered by PersistentConstellation behind us.
 * We just overlay cluster labels positioned at the centroid coordinates.
 */
export function ClustersRevealedPage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroName = useHeroName();
  const [revealed, setRevealed] = useState<number>(0);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });

  useEffect(() => {
    const sync = () => {
      if (containerRef.current) {
        setSize({
          w: containerRef.current.clientWidth,
          h: containerRef.current.clientHeight,
        });
      }
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= HERO_CLUSTERS.length) clearInterval(id);
    }, 320);
    return () => clearInterval(id);
  }, []);

  const cx = size.w / 2;
  const cy = size.h / 2;
  const scale = Math.min(size.w, size.h) * 0.42;

  return (
    <div className="overlay-root" ref={containerRef}>
      <div className="const-chrome-tl">
        <div>
          <b>{heroName}</b>
        </div>
        <div>
          <b>7</b> sub-patterns · 6 tier-1 · 1 tier-2
        </div>
      </div>
      <div className="const-chrome-tr">
        <div className="big">100,000</div>
        <div className="lbl">stress-test complete · 28.4s</div>
      </div>
      {HERO_CLUSTERS.map((c, i) => {
        const px = cx + c.centroid[0] * scale;
        const py = cy + c.centroid[1] * scale;
        const tierLbl = c.tier === "tier_1" ? "T1" : c.tier === "tier_2" ? "T2" : "T3";
        const callShare = Math.round(c.share * 28_400);
        const isVisible = revealed > i;
        return (
          <div
            key={c.cluster_id}
            className={`cluster-label ${c.tier}`}
            style={{
              left: `${px + 18}px`,
              top: `${py - 10}px`,
              opacity: isVisible ? 1 : 0,
              transform: `translateX(${isVisible ? 0 : -8}px)`,
              transition: "opacity 500ms ease, transform 500ms ease",
            }}
          >
            <span className="lbl-tier">{tierLbl}</span>
            cluster #{i + 1} · {c.label} · {callShare.toLocaleString()} calls
          </div>
        );
      })}
      <div className="const-narration">
        seven sub-patterns · <b>six tier-1 typed branches · one tier-2 fallback</b>
      </div>
    </div>
  );
}
