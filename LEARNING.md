# Learning Log

Dated notes on what's actually being learned while building, including dead ends. Not a tutorial — a record.

## 2026-08-02 — Project 01 kickoff

- Started: missed-call follow-up automation for home-service businesses.
- Concepts to pick up this round:
  - n8n webhook triggers and how test vs. production webhook URLs work
  - Calling the Claude API directly via HTTP Request node (no SDK) — headers, auth, request body shape
  - Writing JS in n8n's Code node to parse an API response and reshape data for downstream nodes
  - n8n expression syntax (`={{ }}`) for referencing prior node data, including `$('Node Name')` to reach back further than one step
- Open questions to resolve while building:
  - Where the "missed call" trigger realistically comes from for a real client (call-tracking service webhook vs. Twilio voice webhook vs. a simple web form as a stand-in) — affects how deployable this actually is vs. how it's being demoed for now.
