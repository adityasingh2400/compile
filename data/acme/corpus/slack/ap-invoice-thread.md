# #ap-automation Slack thread — 2026-03-08

**diego.ortiz** [13:40]
> The invoice extractor missed three of the AWS Q1 invoices last week.
> The total ended up as the line-item total, not the grand total. Looks
> like AWS started putting the line items in a left column with right-
> aligned amounts and the OCR is reading them in the wrong order.

**diego.ortiz** [13:41]
> for now I'm post-processing AWS invoices through a hand-rolled regex
> that just grabs the largest USD amount on the page. It's hacky.

**maya.varma** [14:02]
> we should put a note in the spec that AWS specifically uses grand-total-
> at-bottom format. I'll do it now.

**diego.ortiz** [14:04]
> thanks 🙏 also — Sentry now bills in EUR after their reorg.
> currency conversion needs to handle that.

**maya.varma** [14:07]
> noted. adding to the spec.
