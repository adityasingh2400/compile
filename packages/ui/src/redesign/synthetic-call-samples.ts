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

export interface SyntheticSample {
  /** Short imperative phrase displayed next to the node. */
  label: string;
  /** Sub-cluster slug — drives node hue + grouping. */
  cluster: string;
}

interface SamplePack {
  /** Cluster slug → human label. */
  clusters: { slug: string; label: string }[];
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
