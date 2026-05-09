# #sales-ops Slack thread — 2026-04-22

**priya.shah** [09:14]
> reminder: please don't manually override `tier` on inbound leads unless
> the rubric is wrong. if you keep doing it the model just keeps learning
> the wrong patterns. If the rubric is wrong, edit the Notion page and
> @ me.

**marcus.eze** [09:18]
> question — got an inbound from "Anthem" (the insurer). I see ~50k
> employees, $130B revenue. so large. but the AE coverage map says we
> route Anthem to mid because we lost the 2024 RFP and we don't want them
> in strategic again. how do we encode that?

**priya.shah** [09:21]
> that's a routing rule, not a tier. tier them as large per the rubric,
> then the routing layer handles the override. don't lie to the classifier

**aanya.k** [09:24]
> +1. tier == ground truth from the rubric. routing == business rule.
> separate concerns.

**marcus.eze** [09:25]
> got it 👍

**priya.shah** [10:02]
> btw a known pothole: "Visa" the company vs "visa" the document type.
> happens often enough it's worth noting. always pass the full context
> string, not just the bare token.
