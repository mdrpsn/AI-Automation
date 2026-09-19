# AI-Automation

A collection of automation builds for small businesses — one project per build, each
with its own README and supporting files.

## Builds

- [gadgets-more-customer-support](gadgets-more-customer-support/) — Gmail-monitoring
  support agent that classifies incoming emails, answers from reference PDFs (returns,
  repairs, warranties, store policies), and drafts a reply for human review before
  sending. Built in n8n.

- [plumbing-ai-booking-assistant](https://github.com/mdrpsn/plumbing-ai-booking-assistant) —
  FastAPI backend for a local service business: triages incoming customer messages by
  urgency, sends an instant SMS confirmation, offers booking slots, and automatically
  follows up on leads that go quiet — while skipping follow-ups for anyone who already
  replied. Standalone service, not a no-code workflow; SMS and calendar providers are
  swappable (mock for testing, Twilio/real calendar for production). Tested end to end
  with a real running server, not just unit tests.

- [invoice-follow-up-automation](invoice-follow-up-automation/) — daily n8n workflow
  that reads an invoice tracker, escalates unpaid invoices through reminder stages
  (due soon → due today → overdue), and never double-sends. Stops short of automating
  the final overdue notice — that stage alerts a human to make a personal call instead.
  Tested against real sample invoices with real emails sent and a confirmed no-repeat
  run.

- [lead-intake-qualification](lead-intake-qualification/) — webhook-triggered n8n
  workflow that catches new leads from a contact form, scores each one Hot/Warm/Cold
  with an AI classifier, and only pages sales for the hot ones — while auto-replying
  to everyone and logging every lead to a tracker sheet. Skips duplicate alerts for
  the same email resubmitting within 24 hours.