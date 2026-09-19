# Lead Intake & Qualification

An n8n workflow that catches new leads the moment they come in, scores them
with AI, and gets the hot ones in front of sales fast — without a human
having to read every submission first.

## The problem

A contact form or "request a quote" page generates leads in a mix of
temperatures: someone ready to buy this week, someone just browsing, and the
occasional vendor pitch or spam bot. When they all land in one inbox and get
read in order, hot leads sit behind cold noise, and every business owner has
a story about a real customer who slipped through because the email got
buried.

## What it does

1. A webhook catches the form submission the instant it's sent (works with a
   website contact form, Typeform, or any tool that can POST a webhook).
2. The lead is checked against the leads sheet — if the same email already
   submitted in the last 24 hours, it's dropped here. No duplicate alerts,
   no double auto-replies for someone who accidentally submitted twice.
3. An AI classifier (Google Gemini) reads the lead's message and sorts it
   into one of three tiers:

   | Tier | Signal | Action |
   |---|---|---|
   | **Hot** | Urgency, a timeline, or explicit buying intent ("need this this week," "ready to hire") | Instant email alert to sales + an auto-reply promising a callback within the hour |
   | **Warm** | Genuine interest, no urgency yet (general pricing questions, "just exploring") | Auto-reply with a "we'll follow up in a day or two" message — no sales alert, so the team isn't paged for every browser |
   | **Cold / Spam** | Vague, unrelated, or clearly a vendor pitch | Logged only — no email sent to anyone |

4. Every lead — regardless of tier — is appended to a "Leads Tracker" Google
   Sheet with its tier and the reason it was classified that way, so nothing
   is silently dropped and the tracker doubles as a qualification audit
   trail.

## How it works (node by node)

1. **New Lead Webhook** — receives the POST from your form, responds
   immediately so the visitor's browser isn't kept waiting on email sends.
2. **Normalize Lead** — a Code node that pulls `name`/`email`/`phone`/
   `message`/`source` out of whatever field names the form sends and gives
   every lead a `leadId` and timestamp.
3. **Get Existing Leads** — reads the full Leads Tracker sheet.
4. **Check Duplicate** — a Code node comparing the new lead's email against
   the sheet, flagging it as a duplicate only if the same email appears
   *and* was submitted within the last 24 hours.
5. **Not A Duplicate** — filters out anything flagged in step 4.
6. **Qualify Lead** — a Text Classifier node (backed by Gemini) that reads
   the lead's message and sorts it into `hot_lead` / `warm_lead` /
   `cold_lead`.
7. **Tag Hot / Tag Warm / Tag Cold Or Spam** — one Set node per branch,
   recording the tier and a plain-English reason for the log.
8. **Alert Sales - Hot Lead** → **Send Auto-Reply - Hot** — only on the hot
   branch: pages sales, then replies to the lead.
9. **Send Auto-Reply - Warm** — only on the warm branch.
10. **Merge Branches** — recombines the three branches (only one fires per
    lead) back into a single stream.
11. **Log Lead** — appends the lead, its tier, and the reason to the Leads
    Tracker sheet.

## Setting it up for your own business

1. Create a Google Sheet ("Leads Tracker") with columns: `LeadID`, `Name`,
   `Email`, `Phone`, `Message`, `Source`, `Tier`, `QualificationNote`,
   `SubmittedAt`.
2. Import `workflow.json` into your n8n instance.
3. Connect your own credentials (left empty in the export):
   - Google Sheets — on *Get Existing Leads* and *Log Lead*
   - Gmail OAuth2 — on the three send nodes
   - Google Gemini (PaLM) API — on *Google Gemini Chat Model* (free tier at
     [aistudio.google.com](https://aistudio.google.com))
4. Point both Google Sheets nodes at your sheet (`documentId`).
5. Set `Alert Sales - Hot Lead`'s `sendTo` to your sales team's address.
6. Activate the workflow and copy the webhook's production URL into your
   form/tool's "submit to" or "webhook" setting.
7. Adjust the classifier's category descriptions in *Qualify Lead* if "hot"
   means something different for your business (e.g. a specific service
   type or deal size).

## Testing status

Built following the same node patterns as the other two workflows in this
portfolio (`invoice-follow-up-automation`, `gadgets-more-customer-support`),
both of which were validated end to end against a real n8n instance. This
workflow has **not** been run against a live n8n instance or real Gmail/
Sheets credentials in this session — there wasn't one available here. Before
relying on it, run it through n8n's own validation and a few real test
submissions (a hot one, a warm one, a spammy one, and a duplicate) to confirm
the branching and dedup logic behave as designed.

## Known limitations

- The classifier reads only the message text — it doesn't weigh things like
  company size or deal value unless the form collects them and they're fed
  into the `inputText` expression.
- Dedup is by exact email match within a 24-hour window; a lead who
  resubmits under a different email (or misspells it) won't be caught.
- Auto-reply and alert copy are static template strings in the workflow,
  same tradeoff as the invoice automation — fine for one business voice,
  would move to a template store for multi-tenant use.

## Built with

n8n · Google Gemini (free tier) · Google Sheets
