/**
 * Synthetic call samples per workflow.
 *
 * Each sample is one micro-input the codifier would feed into a
 * synthetic run, expressed as a short human-readable phrase. The
 * audit page floats these around the workflow centroid so judges
 * can immediately see what kind of inputs each workflow actually
 * handles in production — instead of staring at unlabeled dots.
 *
 * Samples are tagged with a `cluster` slug so the visual grouping
 * matches the eventual sub-pattern clusters discovered post-synthesis.
 *
 * Lookup is keyword-based on the workflow's `function_name` so the
 * mapping survives renames in the underlying derivation, and falls
 * back to a generic set if no keyword matches.
 */

/**
 * Author metadata shown in the node hover + click detail. Optional —
 * inferred from the label when not authored.
 */
export interface SampleAuthor {
  name: string;
  handle?: string;
  /** Two-letter avatar initials (auto-derived from name if absent). */
  initials?: string;
  /** Hue used for the avatar disc (`maroon` / `coral` / `orange` / etc.). */
  hue?: "maroon" | "coral" | "orange" | "ink";
}

/**
 * Field row rendered in the node-detail overlay. Each row is a small
 * mono `key` paired with a value (string or short JSON).
 */
export interface SampleFieldRow {
  key: string;
  value: string;
  /** When true, render the value in a slightly larger mono block
   *  (used for the raw caption / message body). */
  block?: boolean;
}

/**
 * Full interaction detail for one synthetic call. Hand-authored where
 * the demo benefits, otherwise auto-filled from the deriver.
 */
export interface SampleDetail {
  /** Who the post / message / contact came from. */
  author?: SampleAuthor;
  /** Human readable when ("2h ago", "yesterday"). */
  posted_at?: string;
  /** Provider context shown subtly ("instagram", "imessage"). */
  source?: string;
  /** Ordered list of input rows passed to the LLM. */
  input: SampleFieldRow[];
  /** Ordered list of output rows the LLM (or codified handler) returned. */
  output: SampleFieldRow[];
  /** Match path: how Compile served this call in production. */
  match_type?:
    | "deterministic vault hit"
    | "fuzzy vault hit"
    | "tier-2 phi-3-mini"
    | "frontier fallback";
  /** Confidence on the codified handler's output (0..1). */
  confidence?: number;
  /** Frontier model originally serving this call. */
  frontier_model?: string;
  frontier_latency_ms?: number;
  frontier_cost_usd?: number;
  /** Vault path served via Compile. */
  vault_latency_ms?: number;
  vault_cost_usd?: number;
}

export interface SyntheticSample {
  /** Short imperative phrase displayed next to the node. */
  label: string;
  /** Sub-cluster slug — drives node hue + grouping. */
  cluster: string;
  /** Rich interaction detail. Optional — `inferSampleDetail` fills
   *  in plausible values when this is omitted. */
  detail?: SampleDetail;
}

interface SamplePack {
  /** Cluster slug → human label. */
  clusters: { slug: string; label: string; description?: string }[];
  samples: SyntheticSample[];
}

const PACKS: { match: (fn: string) => boolean; pack: SamplePack }[] = [
  // ─────────────────────────────────────────────────────────────────
  // extract_location_from_post — caption → {city, country, neighborhood}
  {
    match: (fn) => /extract.*location|location.*extract|location.*post/i.test(fn),
    pack: {
      clusters: [
        { slug: "us_cities", label: "US · NYC / SF / LA / Austin" },
        { slug: "asia_pacific", label: "asia · tokyo / shanghai / seoul" },
        { slug: "europe", label: "europe · berlin / london / paris" },
        { slug: "in_transit", label: "in transit · airports / flights" },
        { slug: "throwback_stale", label: "throwback · stale signal" },
      ],
      samples: [
        { label: "back in NYC for the week, hmu", cluster: "us_cities" },
        { label: "first day at the new office in soma", cluster: "us_cities" },
        { label: "live from SXSW panel — link in bio", cluster: "us_cities" },
        { label: "miami till sunday, who's around?", cluster: "us_cities" },
        { label: "sunset at venice beach 🌅", cluster: "us_cities" },
        { label: "vibing in tokyo 🇯🇵 ramen for breakfast", cluster: "asia_pacific" },
        { label: "writing this from a coffee shop in shibuya", cluster: "asia_pacific" },
        { label: "shanghai office — first time in 2 years", cluster: "asia_pacific" },
        { label: "berlin → amsterdam → paris in 5 days", cluster: "europe" },
        { label: "lisbon for the conference this week", cluster: "europe" },
        { label: "just landed at SFO, finally", cluster: "in_transit" },
        { label: "currently at LAX waiting for the redeye", cluster: "in_transit" },
        { label: "driving up the PCH from LA → SF", cluster: "in_transit" },
        { label: "throwback to last summer in lisbon ☀️", cluster: "throwback_stale" },
        { label: "miss this place — taken in 2023", cluster: "throwback_stale" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // extract_activity_from_post — caption → {activity, category}
  {
    match: (fn) => /extract.*activity|activity.*extract|activity.*post/i.test(fn),
    pack: {
      clusters: [
        { slug: "shipping", label: "shipping · launching" },
        { slug: "speaking", label: "speaking · panels" },
        { slug: "career_move", label: "career move · interviews" },
        { slug: "fundraising", label: "fundraising · investor mode" },
        { slug: "personal_milestone", label: "personal milestone" },
        { slug: "training", label: "training · race prep" },
      ],
      samples: [
        { label: "shipping the v3 release tonight 🚀", cluster: "shipping" },
        { label: "running point on the launch thursday", cluster: "shipping" },
        { label: "demoing at YC on tuesday", cluster: "shipping" },
        { label: "panel on AI safety in 30 min", cluster: "speaking" },
        { label: "speaking at recsys next week", cluster: "speaking" },
        { label: "first day teaching CS61A this semester", cluster: "speaking" },
        { label: "interviewing for a new role this week", cluster: "career_move" },
        { label: "took the cofounder job at a stealth startup", cluster: "career_move" },
        { label: "left bigco, working on something with friends", cluster: "career_move" },
        { label: "raising for our seed round — open to intros", cluster: "fundraising" },
        { label: "pitched 6 funds today, brain is fried", cluster: "fundraising" },
        { label: "married last weekend ❤️", cluster: "personal_milestone" },
        { label: "officially a dad 🎉", cluster: "personal_milestone" },
        { label: "moved to a new apartment, deep in unboxing hell", cluster: "personal_milestone" },
        { label: "training for IM Kona in october", cluster: "training" },
        { label: "running boston marathon this morning", cluster: "training" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // classify_post_recency — posted_at + caption → {fresh|recent|stale}
  {
    match: (fn) => /post.*recency|recency.*post|post.*fresh|stale/i.test(fn),
    pack: {
      clusters: [
        { slug: "live", label: "live · <12h old" },
        { slug: "recent", label: "recent · <72h" },
        { slug: "this_month", label: "this month" },
        { slug: "stale_throwback", label: "stale · throwback · drop" },
      ],
      samples: [
        { label: "posted 3hrs ago · \"on stage at SXSW\"", cluster: "live" },
        { label: "posted 1hr ago · \"keynote in 20 min\"", cluster: "live" },
        { label: "posted 8hrs ago · \"goodnight from tokyo\"", cluster: "live" },
        { label: "posted 2d ago · \"two days into onsite\"", cluster: "recent" },
        { label: "posted 3d ago · \"flying to berlin tomorrow\"", cluster: "recent" },
        { label: "posted 12d ago · \"first week at new gig\"", cluster: "this_month" },
        { label: "posted 25d ago · \"april update post\"", cluster: "this_month" },
        { label: "posted 8mo ago · \"summer of 2024 in lisbon\"", cluster: "stale_throwback" },
        { label: "posted 18mo ago · \"thanksgiving with family\"", cluster: "stale_throwback" },
        { label: "posted 2y ago · \"#tbt new years 2024\"", cluster: "stale_throwback" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // route_lookup_to_sources — person + intent → which APIs to hit
  {
    match: (fn) => /route.*source|route.*lookup|source.*route/i.test(fn),
    pack: {
      clusters: [
        { slug: "location_intent", label: "location → IG · FindMy · Maps" },
        { slug: "activity_intent", label: "activity → IG · X · LinkedIn" },
        { slug: "contact_intent", label: "contact → iCloud · Email Finder" },
        { slug: "recent_post_intent", label: "recent post → IG · X · TikTok" },
        { slug: "employment_intent", label: "employment → LinkedIn · CB" },
      ],
      samples: [
        { label: "Sarah Chen · location", cluster: "location_intent" },
        { label: "Liam Walsh · location", cluster: "location_intent" },
        { label: "Ravi Iyer · location", cluster: "location_intent" },
        { label: "Sarah Chen · activity", cluster: "activity_intent" },
        { label: "Alex Tanaka · activity", cluster: "activity_intent" },
        { label: "Camila Santos · activity", cluster: "activity_intent" },
        { label: "Marcus Rodriguez · contact", cluster: "contact_intent" },
        { label: "Nora Bennett · contact", cluster: "contact_intent" },
        { label: "Priya Sharma · recent_post", cluster: "recent_post_intent" },
        { label: "Jenny Patel · recent_post", cluster: "recent_post_intent" },
        { label: "Hana Lee · recent_post", cluster: "recent_post_intent" },
        { label: "David Kim · employment", cluster: "employment_intent" },
        { label: "Yusuke Watanabe · employment", cluster: "employment_intent" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // normalize_social_handle — name → @handle across platforms
  {
    match: (fn) => /normalize.*handle|handle.*normalize|social.*handle/i.test(fn),
    pack: {
      clusters: [
        { slug: "fullname_clean", label: "clean · firstname lastname" },
        { slug: "abbreviated", label: "abbreviated · S. Chen" },
        { slug: "underscore_handle", label: "handle-style · sarah_chen" },
        { slug: "single_word", label: "single token · ambiguous" },
      ],
      samples: [
        { label: "Sarah Chen", cluster: "fullname_clean" },
        { label: "Marcus Rodriguez", cluster: "fullname_clean" },
        { label: "Yusuke Watanabe", cluster: "fullname_clean" },
        { label: "Camila Santos", cluster: "fullname_clean" },
        { label: "sarah c.", cluster: "abbreviated" },
        { label: "Marcus R", cluster: "abbreviated" },
        { label: "P. Sharma", cluster: "abbreviated" },
        { label: "Alex T.", cluster: "abbreviated" },
        { label: "liam_walsh", cluster: "underscore_handle" },
        { label: "camila_s", cluster: "underscore_handle" },
        { label: "yusuke.w", cluster: "underscore_handle" },
        { label: "alex", cluster: "single_word" },
        { label: "ravi", cluster: "single_word" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // classify_message_intent — incoming message → intent label
  {
    match: (fn) => /classify.*intent|intent.*class/i.test(fn),
    pack: {
      clusters: [
        { slug: "scheduling", label: "scheduling" },
        { slug: "urgent", label: "urgent · escalation" },
        { slug: "warmth", label: "warmth · personal" },
        { slug: "logistics", label: "logistics · checkin" },
        { slug: "noise", label: "noise · spam" },
      ],
      samples: [
        { label: "lunch tuesday at noon", cluster: "scheduling" },
        { label: "can we move our 3pm to 4pm?", cluster: "scheduling" },
        { label: "anniversary dinner saturday", cluster: "scheduling" },
        { label: "booked the restaurant for tomorrow", cluster: "scheduling" },
        { label: "team standup tomorrow 10am", cluster: "scheduling" },
        { label: "client: prod is on fire RIGHT NOW", cluster: "urgent" },
        { label: "boss: need this by EOD please", cluster: "urgent" },
        { label: "deadline for the proposal is friday", cluster: "urgent" },
        { label: "happy birthday!!", cluster: "warmth" },
        { label: "love you", cluster: "warmth" },
        { label: "thinking of you", cluster: "warmth" },
        { label: "mom: how was your day", cluster: "warmth" },
        { label: "running 5 mins late", cluster: "logistics" },
        { label: "on my way, ETA 10", cluster: "logistics" },
        { label: "got the package, thanks", cluster: "logistics" },
        { label: "FREE iPhone — click here", cluster: "noise" },
        { label: "claim your reward now", cluster: "noise" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // score_message_urgency — message → urgency 0..1
  {
    match: (fn) => /urgency|priority|score.*urgent/i.test(fn),
    pack: {
      clusters: [
        { slug: "p0", label: "P0 · fire" },
        { slug: "p1", label: "P1 · today" },
        { slug: "p2", label: "P2 · this week" },
        { slug: "p3", label: "P3 · whenever" },
      ],
      samples: [
        { label: "client: prod is on fire RIGHT NOW", cluster: "p0" },
        { label: "site is down, can't log in", cluster: "p0" },
        { label: "need eyes on this, paging", cluster: "p0" },
        { label: "boss: need this by EOD please", cluster: "p1" },
        { label: "deadline today reminder", cluster: "p1" },
        { label: "ship before 5pm", cluster: "p1" },
        { label: "deadline for the proposal is friday", cluster: "p2" },
        { label: "review by end of week", cluster: "p2" },
        { label: "let me know thoughts when free", cluster: "p2" },
        { label: "no plans this weekend, free if around", cluster: "p3" },
        { label: "fyi update, no action needed", cluster: "p3" },
        { label: "coffee invite, no rush", cluster: "p3" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // score_relationship_warmth — contact → warmth 0..1
  {
    match: (fn) => /warmth|relationship|warm/i.test(fn),
    pack: {
      clusters: [
        { slug: "inner", label: "inner circle · daily" },
        { slug: "active", label: "active contacts · weekly" },
        { slug: "ambient", label: "ambient · monthly" },
        { slug: "dormant", label: "dormant · 90d+" },
      ],
      samples: [
        { label: "mom — 142 msgs in last 30d", cluster: "inner" },
        { label: "alex_co_founder — 189 msgs / 30d", cluster: "inner" },
        { label: "sarah_partner — 224 msgs / 30d", cluster: "inner" },
        { label: "best_friend — 96 msgs / 30d", cluster: "inner" },
        { label: "sarah_friend — 87 msgs / 30d", cluster: "active" },
        { label: "investor_dan — 28 msgs / 30d", cluster: "active" },
        { label: "client_acme — 32 msgs / 30d", cluster: "active" },
        { label: "dad — 142 msgs / 30d", cluster: "active" },
        { label: "old_school_friend — 11 msgs / 30d", cluster: "ambient" },
        { label: "ex_coworker — 8 msgs / 30d", cluster: "ambient" },
        { label: "vendor_stripe — 6 msgs / 30d", cluster: "ambient" },
        { label: "mentor_alice — 14 msgs / 30d", cluster: "ambient" },
        { label: "college_roommate — 0 msgs / 90d", cluster: "dormant" },
        { label: "ex_intern — 0 msgs / 120d", cluster: "dormant" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // extract_event_from_message — message → calendar event
  {
    match: (fn) => /extract.*event|event.*extract|calendar/i.test(fn),
    pack: {
      clusters: [
        { slug: "deadline", label: "deadlines" },
        { slug: "meeting", label: "meetings · calls" },
        { slug: "social", label: "social · meals" },
        { slug: "travel", label: "travel · transit" },
      ],
      samples: [
        { label: "deadline for the proposal is friday", cluster: "deadline" },
        { label: "draft due monday eod", cluster: "deadline" },
        { label: "ship by end of sprint", cluster: "deadline" },
        { label: "can we move our 3pm to 4pm?", cluster: "meeting" },
        { label: "team standup tomorrow 10am", cluster: "meeting" },
        { label: "intro call thursday at 2", cluster: "meeting" },
        { label: "demo for the board next tuesday", cluster: "meeting" },
        { label: "anniversary dinner saturday", cluster: "social" },
        { label: "lunch tuesday at noon", cluster: "social" },
        { label: "drinks tonight after 7", cluster: "social" },
        { label: "bday party saturday 8pm", cluster: "social" },
        { label: "flight at 7am, jfk → sfo", cluster: "travel" },
        { label: "uber booked for 6:15", cluster: "travel" },
        { label: "train arrives 10:42", cluster: "travel" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // summarize_thread_for_memory — thread → memory note
  {
    match: (fn) => /summari[sz]e|memory|recap/i.test(fn),
    pack: {
      clusters: [
        { slug: "decision", label: "decisions · outcomes" },
        { slug: "context", label: "context · status" },
        { slug: "vibe", label: "vibe · sentiment" },
      ],
      samples: [
        { label: "alex thread · agreed to ship friday", cluster: "decision" },
        { label: "sarah thread · picked thursday 8pm", cluster: "decision" },
        { label: "client thread · accepted scope", cluster: "decision" },
        { label: "team thread · staging deploys again", cluster: "context" },
        { label: "mom thread · weekend visit planned", cluster: "context" },
        { label: "investor thread · waiting on update", cluster: "context" },
        { label: "boss thread · pleased with progress", cluster: "vibe" },
        { label: "co-founder · race condition fixed", cluster: "vibe" },
        { label: "friend · low-stakes check-in", cluster: "vibe" },
      ],
    },
  },
];

const FALLBACK_PACK: SamplePack = {
  clusters: [
    { slug: "common_a", label: "common · primary" },
    { slug: "common_b", label: "common · secondary" },
    { slug: "edge", label: "edge cases" },
  ],
  samples: [
    { label: "this user's primary input · variant 1", cluster: "common_a" },
    { label: "this user's primary input · variant 2", cluster: "common_a" },
    { label: "this user's primary input · variant 3", cluster: "common_a" },
    { label: "this user's primary input · variant 4", cluster: "common_a" },
    { label: "this user's secondary input · variant 1", cluster: "common_b" },
    { label: "this user's secondary input · variant 2", cluster: "common_b" },
    { label: "this user's secondary input · variant 3", cluster: "common_b" },
    { label: "edge · adversarial input", cluster: "edge" },
    { label: "edge · noise input", cluster: "edge" },
  ],
};

export function getSamplePack(functionName: string): SamplePack {
  for (const entry of PACKS) {
    if (entry.match(functionName)) return entry.pack;
  }
  return FALLBACK_PACK;
}

// ─────────────────────────────────────────────────────────────────────
// Detail deriver — synthesizes plausible interaction data from
// (function_name + cluster + label). Each workflow kind maps to a
// builder that returns:
//
//   - input: the structured shape passed to the LLM (caption + meta)
//   - output: the parsed JSON the codified handler returns
//   - match_type: which path served this in production
//   - latency / cost numbers for the frontier vs vault comparison
//
// The deriver is deterministic: same (fn, label, cluster) → same
// detail. The author / handle is hashed off the label so the same
// "Sarah Chen · location" always shows Sarah Chen.
//
// When a sample carries an authored `detail` (richer copy from the
// data agent), the deriver is bypassed.

const FIRST_NAMES = [
  "Sarah", "Marcus", "Yusuke", "Camila", "Ravi", "Priya", "Liam", "Hana",
  "Jenny", "Alex", "Nora", "David", "Elena", "Chen", "Maya", "Jordan",
  "Aria", "Tomás", "Zoe", "Theo", "Imani", "Devi", "Olu", "Rin",
];
const LAST_NAMES = [
  "Chen", "Rodriguez", "Watanabe", "Santos", "Iyer", "Sharma", "Walsh",
  "Lee", "Patel", "Tanaka", "Bennett", "Kim", "Park", "Garcia", "Singh",
  "Nguyen", "Cohen", "Adler", "O'Connor", "Müller",
];

/** djb2-style hash → small positive integer; deterministic on string. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickFromArray<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length] as T;
}

function deriveAuthor(label: string): SampleAuthor {
  // If the label already contains a "Name · …" or "Name —" form,
  // reuse that. Otherwise hash an author from FIRST/LAST.
  const nameMatch = label.match(/^([A-Z][a-zà-ÿ]+(?:\s[A-Z][a-zà-ÿ]+)?)\s*[·—-]/);
  const fromLabel = nameMatch?.[1];
  const seed = hashStr(label);
  const first = fromLabel ?? `${pickFromArray(FIRST_NAMES, seed)} ${pickFromArray(LAST_NAMES, seed >> 3)}`;
  const handle = "@" + first.toLowerCase().replace(/[^a-z]/g, "");
  const initials = first
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]!)
    .join("")
    .toUpperCase();
  const hueChoices: SampleAuthor["hue"][] = ["maroon", "coral", "orange", "ink"];
  const hue = hueChoices[seed % hueChoices.length];
  return { name: first, handle, initials, hue };
}

function pickPostedAt(seed: number, cluster: string): string {
  // Cluster-aware: stale clusters get older timestamps, live clusters get fresh.
  if (/stale|throwback|drop/i.test(cluster)) {
    return pickFromArray(
      ["8mo ago", "1y ago", "2y ago", "18mo ago", "3y ago"],
      seed,
    );
  }
  if (/live|fresh|p0|urgent/i.test(cluster)) {
    return pickFromArray(["just now", "5m ago", "12m ago", "30m ago", "1h ago"], seed);
  }
  if (/recent|p1|today/i.test(cluster)) {
    return pickFromArray(["2h ago", "4h ago", "8h ago", "yesterday", "1d ago"], seed);
  }
  if (/dormant/i.test(cluster)) {
    return pickFromArray(["120d ago", "180d ago", "300d ago", "1y ago"], seed);
  }
  return pickFromArray(["2d ago", "5d ago", "1w ago", "2w ago", "3w ago"], seed);
}

interface DerivedShape {
  source: string;
  input: SampleFieldRow[];
  output: SampleFieldRow[];
  matchType: SampleDetail["match_type"];
  confidence: number;
  frontierModel: string;
  frontierLatency: number;
  frontierCost: number;
  vaultLatency: number;
  vaultCost: number;
}

function buildLocationShape(label: string, cluster: string, seed: number): DerivedShape {
  const us = ["us_cities"].includes(cluster);
  const asia = cluster.startsWith("asia");
  const eu = cluster.startsWith("europe");
  const transit = cluster === "in_transit";
  const stale = cluster === "throwback_stale";
  const city = transit
    ? pickFromArray(["SFO", "LAX", "JFK", "LHR", "HND"], seed)
    : us
      ? pickFromArray(["New York", "San Francisco", "Los Angeles", "Austin", "Miami", "Venice Beach"], seed)
      : asia
        ? pickFromArray(["Tokyo", "Shanghai", "Seoul", "Shibuya"], seed)
        : eu
          ? pickFromArray(["Berlin", "Amsterdam", "Paris", "Lisbon", "London"], seed)
          : pickFromArray(["Unknown", "—", null as unknown as string], seed) ?? "Unknown";
  const country = us ? "US" : asia ? pickFromArray(["JP", "CN", "KR"], seed) : eu ? pickFromArray(["DE", "FR", "PT", "GB", "NL"], seed) : "—";
  const conf = stale ? 0.42 : transit ? 0.78 : 0.94;
  return {
    source: "instagram",
    input: [
      { key: "caption", value: `"${label}"`, block: true },
      { key: "geotag", value: stale ? "(none)" : pickFromArray(["📍 SFO", "📍 venice beach", "📍 shibuya, tokyo", "📍 la condesa, mx", "(none)"], seed) },
      { key: "media_type", value: pickFromArray(["photo", "carousel", "reel"], seed) },
    ],
    output: [
      { key: "city", value: stale ? "null" : `"${city}"` },
      { key: "country", value: stale ? "null" : `"${country}"` },
      { key: "neighborhood", value: cluster === "us_cities" && city === "San Francisco" ? '"soma"' : "null" },
      { key: "confidence", value: conf.toFixed(2) },
    ],
    matchType: stale ? "frontier fallback" : transit ? "fuzzy vault hit" : "deterministic vault hit",
    confidence: conf,
    frontierModel: "gpt-5",
    frontierLatency: 380 + (seed % 220),
    frontierCost: 0.0024,
    vaultLatency: stale ? 0 : 1 + (seed % 3),
    vaultCost: stale ? 0 : 0.0001,
  };
}

function buildActivityShape(label: string, cluster: string, seed: number): DerivedShape {
  const map: Record<string, { activity: string; category: string; professional: boolean }> = {
    shipping: { activity: "shipping a release", category: "professional · launch", professional: true },
    speaking: { activity: "speaking · panel", category: "professional · public", professional: true },
    career_move: { activity: "changing roles", category: "professional · career", professional: true },
    fundraising: { activity: "fundraising", category: "professional · raise", professional: true },
    personal_milestone: { activity: "personal milestone", category: "personal · life event", professional: false },
    training: { activity: "training", category: "personal · fitness", professional: false },
  };
  const m = map[cluster] ?? { activity: "unknown", category: "—", professional: false };
  return {
    source: "instagram",
    input: [
      { key: "caption", value: `"${label}"`, block: true },
      { key: "media_type", value: pickFromArray(["photo", "reel", "story"], seed) },
      { key: "hashtags", value: pickFromArray(["#shipit", "#building", "#raising", "#sxsw", "(none)"], seed) },
    ],
    output: [
      { key: "activity", value: `"${m.activity}"` },
      { key: "category", value: `"${m.category}"` },
      { key: "professional", value: String(m.professional) },
      { key: "confidence", value: "0.93" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.93,
    frontierModel: "gpt-5",
    frontierLatency: 410 + (seed % 200),
    frontierCost: 0.0026,
    vaultLatency: 1,
    vaultCost: 0.0001,
  };
}

function buildRecencyShape(label: string, cluster: string, seed: number): DerivedShape {
  const ageMap: Record<string, { recency: string; stale: boolean; conf: number }> = {
    live: { recency: "live", stale: false, conf: 0.99 },
    recent: { recency: "recent", stale: false, conf: 0.96 },
    this_month: { recency: "this_month", stale: false, conf: 0.92 },
    stale_throwback: { recency: "stale", stale: true, conf: 0.97 },
  };
  const m = ageMap[cluster] ?? ageMap.recent!;
  const tsMatch = label.match(/posted\s+([^·]+)·/);
  const captionMatch = label.match(/·\s+"([^"]+)"/);
  const posted = tsMatch?.[1]?.trim() ?? "—";
  const caption = captionMatch?.[1] ?? label;
  return {
    source: "instagram",
    input: [
      { key: "posted_at", value: posted },
      { key: "caption", value: `"${caption}"`, block: true },
    ],
    output: [
      { key: "recency", value: `"${m.recency}"` },
      { key: "stale", value: String(m.stale) },
      { key: "confidence", value: m.conf.toFixed(2) },
    ],
    matchType: "deterministic vault hit",
    confidence: m.conf,
    frontierModel: "gpt-5",
    frontierLatency: 280 + (seed % 120),
    frontierCost: 0.0018,
    vaultLatency: 0,
    vaultCost: 0.00005,
  };
}

function buildSourceRouterShape(label: string, cluster: string, seed: number): DerivedShape {
  const map: Record<string, { sources: string[]; priority: string[] }> = {
    location_intent: {
      sources: ["instagram", "find_my", "google_maps"],
      priority: ["instagram", "find_my", "google_maps"],
    },
    activity_intent: { sources: ["instagram", "twitter", "linkedin"], priority: ["instagram", "twitter", "linkedin"] },
    contact_intent: { sources: ["icloud", "email_finder"], priority: ["icloud", "email_finder"] },
    recent_post_intent: { sources: ["instagram", "twitter", "tiktok"], priority: ["instagram", "twitter", "tiktok"] },
    employment_intent: { sources: ["linkedin", "crunchbase"], priority: ["linkedin", "crunchbase"] },
  };
  const m = map[cluster] ?? map.location_intent!;
  const personMatch = label.match(/^(.+?)\s+·\s+(.+)$/);
  const person = personMatch?.[1] ?? "Unknown";
  const intent = personMatch?.[2] ?? "lookup";
  return {
    source: "internal_router",
    input: [
      { key: "person", value: `"${person}"` },
      { key: "intent", value: `"${intent}"` },
    ],
    output: [
      { key: "sources", value: `[${m.sources.map((s) => `"${s}"`).join(", ")}]` },
      { key: "priority_order", value: `[${m.priority.slice(0, 2).map((s) => `"${s}"`).join(", ")} …]` },
      { key: "skip_reason", value: "null" },
    ],
    matchType: "tier-2 phi-3-mini",
    confidence: 0.88,
    frontierModel: "claude-sonnet-4-6",
    frontierLatency: 540 + (seed % 280),
    frontierCost: 0.0078,
    vaultLatency: 50 + (seed % 30),
    vaultCost: 0.0001,
  };
}

function buildHandleShape(label: string, cluster: string, seed: number): DerivedShape {
  const variants: Record<string, { ig: string; tw: string; li: string; conf: number }> = {
    fullname_clean: { ig: "@sarah.chen", tw: "@sarahc", li: "/in/sarahchen", conf: 0.92 },
    abbreviated: { ig: "@s.chen", tw: "@schen", li: "/in/sarahchen", conf: 0.74 },
    underscore_handle: { ig: `@${label}`, tw: `@${label.replace(/_/g, "")}`, li: `/in/${label.replace(/_/g, "")}`, conf: 0.81 },
    single_word: { ig: "(ambiguous)", tw: "(ambiguous)", li: "(ambiguous)", conf: 0.4 },
  };
  const m = variants[cluster] ?? variants.fullname_clean!;
  return {
    source: "internal_normalize",
    input: [{ key: "name", value: `"${label}"`, block: true }],
    output: [
      { key: "instagram", value: `"${m.ig}"` },
      { key: "twitter", value: `"${m.tw}"` },
      { key: "linkedin", value: `"${m.li}"` },
      { key: "confidence", value: m.conf.toFixed(2) },
    ],
    matchType: cluster === "single_word" ? "frontier fallback" : "deterministic vault hit",
    confidence: m.conf,
    frontierModel: "gpt-5",
    frontierLatency: 320 + (seed % 100),
    frontierCost: 0.002,
    vaultLatency: cluster === "single_word" ? 0 : 1,
    vaultCost: cluster === "single_word" ? 0 : 0.00005,
  };
}

function buildIntentShape(label: string, cluster: string, seed: number): DerivedShape {
  const map: Record<string, string> = {
    scheduling: "scheduling",
    urgent: "urgent_escalation",
    warmth: "warmth_personal",
    logistics: "logistics_checkin",
    noise: "noise_spam",
  };
  const intent = map[cluster] ?? "unknown";
  return {
    source: "imessage",
    input: [{ key: "message", value: `"${label}"`, block: true }],
    output: [
      { key: "intent", value: `"${intent}"` },
      { key: "confidence", value: "0.95" },
    ],
    matchType: cluster === "noise" ? "deterministic vault hit" : "fuzzy vault hit",
    confidence: 0.95,
    frontierModel: "gpt-5",
    frontierLatency: 240 + (seed % 120),
    frontierCost: 0.0014,
    vaultLatency: 1,
    vaultCost: 0.00004,
  };
}

function buildUrgencyShape(label: string, cluster: string, seed: number): DerivedShape {
  const tier = cluster.toUpperCase();
  const score = cluster === "p0" ? 0.98 : cluster === "p1" ? 0.78 : cluster === "p2" ? 0.45 : 0.12;
  return {
    source: "imessage",
    input: [{ key: "message", value: `"${label}"`, block: true }],
    output: [
      { key: "urgency", value: `"${tier}"` },
      { key: "score", value: score.toFixed(2) },
      { key: "confidence", value: "0.93" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.93,
    frontierModel: "gpt-5",
    frontierLatency: 220 + (seed % 100),
    frontierCost: 0.0012,
    vaultLatency: 1,
    vaultCost: 0.00004,
  };
}

function buildWarmthShape(label: string, cluster: string, seed: number): DerivedShape {
  const score = cluster === "inner" ? 0.95 : cluster === "active" ? 0.72 : cluster === "ambient" ? 0.38 : 0.08;
  return {
    source: "imessage",
    input: [{ key: "contact", value: `"${label}"`, block: true }],
    output: [
      { key: "warmth", value: score.toFixed(2) },
      { key: "bucket", value: `"${cluster}"` },
      { key: "confidence", value: "0.92" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.92,
    frontierModel: "claude-sonnet-4-6",
    frontierLatency: 510 + (seed % 200),
    frontierCost: 0.005,
    vaultLatency: 1,
    vaultCost: 0.00004,
  };
}

function buildEventShape(label: string, cluster: string, seed: number): DerivedShape {
  return {
    source: "imessage",
    input: [{ key: "message", value: `"${label}"`, block: true }],
    output: [
      { key: "event_type", value: `"${cluster}"` },
      { key: "when", value: pickFromArray(["friday 17:00", "tuesday 12:00", "saturday 20:00", "thursday 14:00"], seed) },
      { key: "confidence", value: "0.91" },
    ],
    matchType: "fuzzy vault hit",
    confidence: 0.91,
    frontierModel: "gpt-5",
    frontierLatency: 360 + (seed % 140),
    frontierCost: 0.002,
    vaultLatency: 2,
    vaultCost: 0.00006,
  };
}

function buildGenericShape(label: string, cluster: string, seed: number): DerivedShape {
  return {
    source: "internal",
    input: [{ key: "input", value: `"${label}"`, block: true }],
    output: [
      { key: "label", value: `"${cluster}"` },
      { key: "confidence", value: "0.9" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.9,
    frontierModel: "gpt-5",
    frontierLatency: 300 + (seed % 200),
    frontierCost: 0.0018,
    vaultLatency: 1,
    vaultCost: 0.00005,
  };
}

const SHAPE_BUILDERS: { match: (fn: string) => boolean; build: typeof buildGenericShape }[] = [
  { match: (fn) => /location.*post|extract.*location/i.test(fn), build: buildLocationShape },
  { match: (fn) => /activity.*post|extract.*activity/i.test(fn), build: buildActivityShape },
  { match: (fn) => /post.*recency|recency.*post|fresh|stale/i.test(fn), build: buildRecencyShape },
  { match: (fn) => /route.*source|route.*lookup|source.*route/i.test(fn), build: buildSourceRouterShape },
  { match: (fn) => /normalize.*handle|handle.*normalize/i.test(fn), build: buildHandleShape },
  { match: (fn) => /classify.*intent|intent.*class/i.test(fn), build: buildIntentShape },
  { match: (fn) => /urgency|priority/i.test(fn), build: buildUrgencyShape },
  { match: (fn) => /warmth|relationship/i.test(fn), build: buildWarmthShape },
  { match: (fn) => /event|calendar/i.test(fn), build: buildEventShape },
];

/**
 * Returns the rich SampleDetail for a sample, hand-authored or derived.
 *
 * The other agent on the team is iterating on the perfect mock data —
 * when they author `sample.detail`, this function returns it verbatim.
 * Until then it produces deterministic, plausible interaction data.
 */
export function inferSampleDetail(
  functionName: string,
  sample: SyntheticSample,
): SampleDetail {
  if (sample.detail) return sample.detail;

  const seed = hashStr(`${functionName}:${sample.label}:${sample.cluster}`);
  const builder =
    SHAPE_BUILDERS.find((b) => b.match(functionName))?.build ?? buildGenericShape;
  const shape = builder(sample.label, sample.cluster, seed);

  return {
    author: deriveAuthor(sample.label),
    posted_at: pickPostedAt(seed, sample.cluster),
    source: shape.source,
    input: shape.input,
    output: shape.output,
    match_type: shape.matchType,
    confidence: shape.confidence,
    frontier_model: shape.frontierModel,
    frontier_latency_ms: shape.frontierLatency,
    frontier_cost_usd: shape.frontierCost,
    vault_latency_ms: shape.vaultLatency,
    vault_cost_usd: shape.vaultCost,
  };
}

/**
 * Cluster description lookup — used by the cluster-zoom panel to
 * explain "what makes a node belong here". Defaults to a derived
 * one-liner if the pack didn't author it.
 */
export function getClusterDescription(
  pack: SamplePack,
  clusterSlug: string,
): string {
  const c = pack.clusters.find((x) => x.slug === clusterSlug);
  if (c?.description) return c.description;
  // Fallback heuristic — count + cluster label.
  const count = pack.samples.filter((s) => s.cluster === clusterSlug).length;
  const label = c?.label ?? clusterSlug;
  return `${count} synthetic call${count === 1 ? "" : "s"} matched the ${label} pattern.`;
}
