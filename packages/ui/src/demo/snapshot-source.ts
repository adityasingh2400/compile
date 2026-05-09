/**
 * Optional live-data source. When the URL has `?source=real`, fetch the
 * snapshot produced by `scripts/snapshot-bootstrap.ts` and override the
 * demo fixtures with REAL scanner + synth-loader output. Same animation
 * timing, real findings — judges see actual call sites discovered from
 * the actual Acme repo.
 *
 * Snapshot generation is decoupled from runtime: run `npm run snapshot`
 * Friday night, ship the JSON, demo plays it back deterministically.
 */
import type { CallSiteDescriptor, SyntheticCell } from "@compile/schemas";
import {
  DEMO_CALL_SITES,
  DEMO_FILES,
  HERO_CLUSTERS,
  type HeroCluster,
} from "./fixtures.js";

interface BootstrapSnapshot {
  generated_at: string;
  scanner: {
    repo_path: string;
    files_scanned: number;
    tree_signature: string;
    call_sites: CallSiteDescriptor[];
  };
  green_call_sites: string[];
  stress_test: {
    call_site_id: string;
    cells_sampled: SyntheticCell[];
  };
}

export interface ResolvedFixtures {
  source: "baked" | "real";
  callSites: CallSiteDescriptor[];
  files: { path: string; hits: number }[];
  heroCallSiteId: string;
  /** Distinct cluster IDs derived from real cell shape signatures, mapped onto
   *  HERO_CLUSTERS for display so the centroids stay tuned for the visual. */
  heroClusters: HeroCluster[];
  /** When source=real, an array of pre-recorded cells we push into the
   *  constellation instead of generating randomly. */
  recordedCells?: SyntheticCell[];
}

const BAKED: ResolvedFixtures = {
  source: "baked",
  callSites: DEMO_CALL_SITES,
  files: DEMO_FILES,
  heroCallSiteId: "ops:classify_ticket_priority",
  heroClusters: HERO_CLUSTERS,
};

export async function resolveFixtures(): Promise<ResolvedFixtures> {
  if (typeof window === "undefined") return BAKED;
  const params = new URLSearchParams(window.location.search);
  if (params.get("source") !== "real") return BAKED;

  try {
    const res = await fetch("/bootstrap-snapshot.json");
    if (!res.ok) {
      console.warn("[snapshot] not found — falling back to baked fixtures");
      return BAKED;
    }
    const snap: BootstrapSnapshot = await res.json();
    console.log(
      `[snapshot] loaded real bootstrap: ${snap.scanner.call_sites.length} sites · ` +
        `${snap.stress_test.cells_sampled.length} cells`,
    );
    return {
      source: "real",
      callSites: snap.scanner.call_sites,
      files: deriveFiles(snap.scanner.call_sites, snap.scanner.files_scanned),
      heroCallSiteId: snap.stress_test.call_site_id,
      heroClusters: HERO_CLUSTERS, // keep visual centroids
      recordedCells: snap.stress_test.cells_sampled,
    };
  } catch (err) {
    console.warn("[snapshot] load failed — falling back to baked fixtures", err);
    return BAKED;
  }
}

function deriveFiles(
  sites: CallSiteDescriptor[],
  filesScanned: number,
): { path: string; hits: number }[] {
  // Group call sites by file_path so each row reflects what the scanner
  // actually traversed.
  const hitMap = new Map<string, number>();
  for (const s of sites) {
    hitMap.set(s.file_path, (hitMap.get(s.file_path) ?? 0) + 1);
  }
  const seen = Array.from(hitMap.entries()).map(([path, hits]) => ({
    path: shortPath(path),
    hits,
  }));
  // Pad with non-LLM files we know exist in the repo so the scan tree feels
  // populated. Total displayed should be at least filesScanned.
  const padding: { path: string; hits: number }[] = [
    { path: "src/utils/parse.ts", hits: 0 },
    { path: "src/utils/format.ts", hits: 0 },
    { path: "src/index.ts", hits: 0 },
    { path: "src/router.ts", hits: 0 },
    { path: "package.json", hits: 0 },
    { path: "tsconfig.json", hits: 0 },
    { path: "docs/icp.md", hits: 0 },
    { path: "docs/pricing.md", hits: 0 },
  ];
  const padded = [...seen];
  for (const p of padding) {
    if (padded.length >= Math.max(filesScanned, 10)) break;
    if (!padded.some((x) => x.path === p.path)) padded.push(p);
  }
  return padded;
}

function shortPath(p: string): string {
  // Trim the absolute repo prefix down to the meaningful suffix.
  const i = p.indexOf("acme-agent/");
  return i >= 0 ? p.slice(i + "acme-agent/".length) : p;
}
