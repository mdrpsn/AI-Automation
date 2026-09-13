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