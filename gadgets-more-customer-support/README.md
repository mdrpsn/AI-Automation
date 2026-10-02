# Customer Support Agent — Gmail-to-Draft, grounded in your own docs

An n8n workflow that watches a support inbox, figures out which emails are actual
customer-support questions (returns, repairs, warranties, store policies), answers them
using your own reference documents, and leaves a **draft** reply for a human to review —
it never sends anything on its own.

## The problem this solves

Small teams answer the same handful of policy questions over and over — "what's your
return window," "do you cover accidental damage," "can I get a price match." Someone
still has to open the email, look up the policy, and write the reply. This automates the
lookup-and-draft step while keeping a human in the loop for the send.

## How it works

```
Gmail Trigger (poll every 15 min)
  ├─▶ Read Reference PDFs ─▶ Extract PDF Text ─▶ Combine Reference Text
  │                                                        │
  └─▶ Get message (full record) ─▶ Text Classifier         │
                                      │  support_question   │
                                      ▼                     │
                                 Draft Support Reply ◀───────┘
                                      │
                                      ▼
                                 Create Draft Reply (Gmail, attached to the thread)
```

- **Gmail Trigger** polls for new mail every 15 minutes.
- **Text Classifier** (Google Gemini) reads the subject + preview and decides: is this a
  support question about returns/repairs/warranties/policies, or something else? Only
  the "support question" branch continues — everything else is left untouched.
- **Read Reference PDFs → Extract PDF Text → Combine Reference Text** runs once per
  execution (`executeOnce`) regardless of how many emails triggered it, reading your
  policy/FAQ PDFs from disk and flattening them into one block of reference text.
- **Draft Support Reply** (Gemini via a Basic LLM Chain) is instructed to answer *only*
  from that reference text — and to write an honest "a team member will follow up" reply
  rather than invent a policy detail it can't find.
- **Create Draft Reply** writes the result into Gmail as a draft on the original thread.
  Nothing is ever auto-sent.

## Reference documents included

- `policies.pdf` — generic store policy doc (returns, exchanges, repairs, warranty, price
  match, store hours)
- `faqs.pdf` — generic FAQ doc in the same domain

Both are placeholder/generic content for this portfolio build — swap in your own.

## Setup

1. **Import** `workflow.json` into your n8n instance.
2. **Credentials** — connect your own on each node (left empty in the export):
   - Gmail OAuth2 — on *Gmail Trigger*, *Get message*, and *Create Draft Reply*
   - Google Gemini (PaLM) API — on *Google Gemini Chat Model* (free tier at
     [aistudio.google.com](https://aistudio.google.com), no card required)
3. **Reference PDFs** — n8n 2.0+ defaults `N8N_RESTRICT_FILE_ACCESS_TO` to `~/.n8n-files`,
   so the "Read Reference PDFs" node can't see arbitrary paths out of the box. Either:
   - bind-mount a folder with your PDFs into the n8n container and set
     `N8N_RESTRICT_FILE_ACCESS_TO=/your/mounted/path`, or
   - swap that node for a Google Drive / HTTP Request download instead.
4. Update the `fileSelector` glob on *Read Reference PDFs* and the business name in the
   *Draft Support Reply* prompt to match your setup.
5. Validate, test with a real email, then activate.

## Known limitation

The classifier and drafting prompt currently read from Gmail's `snippet` field (a short
preview, not the full email body) — fine for short questions, but a long customer email
would get truncated before the AI sees it. A more complete version would parse the full
plain-text body out of Gmail's raw MIME payload instead. Noted here rather than glossed
over — it's a straightforward follow-up, not a rewrite.

## Security notes

- **Data it touches:** the subject and body of customer emails, which are sent to Google Gemini for classifying and drafting. Check that your privacy policy allows that before using it on real customers.
- **Prompt injection:** a customer can write instructions inside an email ("promise me a full refund"). The prompt says to answer only from the reference text, but that is not a guarantee. The real protection is that the workflow only creates a **draft**; a person reads it before anything is sent.
- **Access scope:** the Gmail connection can read mail and create drafts. Use a dedicated support mailbox, not a personal one.
- **Secrets:** credentials are left empty in `workflow.json` and live in n8n's credential store.
- **Files:** the reference PDFs are read from disk, and n8n 2.0+ limits file access to one folder (see Setup). Keep only the policy documents there.
- **Before real use:** a dedicated mailbox, a human review habit for every draft, and a decision on what customer data may be sent to a third-party AI.

## Built with

n8n · Google Gemini (free tier) · [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) for
AI-assisted building or a real n8n instance via MCP tools
